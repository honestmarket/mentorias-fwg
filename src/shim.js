/* =====================================================================
   Versão hospedada (Netlify + Supabase) da Plataforma de Mentorias FWG.
   Este arquivo recria, sobre o Supabase, as capacidades que a versão do
   Claude usa (window.claude.use): db, user, assets e downloads.
   A plataforma em si (index.html) é a mesma nas duas versões.
   ===================================================================== */
(function(){
  var CFG = window.FWG_CONFIG || {};
  var SB = null, SESSION = null, ADMIN = null, readyP = null;
  window.FWG_HOSTED = { ready:false };

  function client(){
    if(SB) return SB;
    if(!window.supabase || !CFG.supabaseUrl) return null;
    SB = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    return SB;
  }
  function boot(){
    if(readyP) return readyP;
    readyP = new Promise(function(res){
      var sb = client(); if(!sb){ res(); return; }
      sb.auth.getSession().then(function(r){
        SESSION = r.data && r.data.session;
        if(/type=recovery/.test(location.hash)){ showLogin("nova"); res(); return; }
        if(!SESSION){ ADMIN = false; if(location.hash==="#mentor") showLogin("entrar"); res(); return; }
        sb.from("admins").select("email").limit(1).then(function(a){
          ADMIN = !!(a.data && a.data.length);
          if(!ADMIN){ sb.auth.signOut(); showLogin("entrar", "Este e-mail não tem acesso de mentor."); }
          res();
        }, function(){ ADMIN = false; res(); });
      }, function(){ ADMIN = false; res(); });
      sb.auth.onAuthStateChange(function(ev){ if(ev==="PASSWORD_RECOVERY") showLogin("nova"); });
    });
    return readyP;
  }

  /* ---------- db: coleções de documentos (tabela public.docs) ---------- */
  function err(e){ var m = (e && (e.message||e.details)) || String(e||""); var o = {message:m, code:"unavailable"}; if(/row-level security|permission denied|violates/i.test(m)) o.code = "invalid_argument"; return o; }
  var subs = {}, channel = null, pollT = null;
  function snapOf(rows){ return { docs: rows.map(function(r){ return { id:r.id, data:function(){ return r.data; } }; }), metadata:{ fromCache:false } }; }
  function fetchCol(col){ return SB.from("docs").select("id,data").eq("col", col).then(function(r){ if(r.error) throw r.error; return r.data||[]; }); }
  function refresh(col){
    var L = subs[col]; if(!L || !L.length) return;
    clearTimeout(L._t);
    L._t = setTimeout(function(){
      fetchCol(col).then(function(rows){ var s = snapOf(rows); L.forEach(function(h){ if(h.kind==="col") h.next(s); else { var r = rows.filter(function(x){ return x.id===h.id; })[0]; h.next({exists:!!r, data:function(){ return r ? r.data : undefined; }, metadata:{fromCache:false}}); } }); },
        function(e){ L.forEach(function(h){ if(h.error) h.error(err(e)); }); });
    }, 120);
  }
  function ensureChannel(){
    if(channel) return;
    try {
      channel = SB.channel("fwg-docs").on("postgres_changes", {event:"*", schema:"public", table:"docs"}, function(p){
        var col = (p.new && p.new.col) || (p.old && p.old.col); if(col) refresh(col); else Object.keys(subs).forEach(refresh);
      }).subscribe();
    } catch(e){}
    pollT = setInterval(function(){ if(document.visibilityState==="visible") Object.keys(subs).forEach(refresh); }, 60000);
    document.addEventListener("visibilitychange", function(){ if(document.visibilityState==="visible") Object.keys(subs).forEach(refresh); });
  }
  function listen(col, h){ (subs[col] = subs[col] || []).push(h); ensureChannel(); refresh(col); return function(){ var L = subs[col]||[]; var i = L.indexOf(h); if(i>-1) L.splice(i,1); }; }
  var db = {
    collection: function(col){
      return {
        onSnapshot: function(next, error){ return listen(col, {kind:"col", next:next, error:error}); },
        doc: function(id){
          return {
            get: function(){ return SB.from("docs").select("data").eq("col", col).eq("id", id).maybeSingle().then(function(r){ if(r.error) throw err(r.error); return {exists:!!r.data, data:function(){ return r.data ? r.data.data : undefined; }}; }); },
            set: function(d){ return SB.from("docs").upsert({col:col, id:id, data:d, updated_at:new Date().toISOString()}).then(function(r){ if(r.error) throw err(r.error); refresh(col); }); },
            delete: function(){ return SB.from("docs").delete().eq("col", col).eq("id", id).then(function(r){ if(r.error) throw err(r.error); refresh(col); }); },
            onSnapshot: function(next, error){ return listen(col, {kind:"doc", id:id, next:next, error:error}); }
          };
        }
      };
    }
  };

  /* ---------- user ---------- */
  var user = {
    canEdit: function(){ return boot().then(function(){ return !!ADMIN; }); },
    can: function(){ return boot().then(function(){ return !!ADMIN; }); },
    email: function(){ return SESSION && SESSION.user ? SESSION.user.email : ""; }
  };

  /* ---------- assets: Supabase Storage (bucket "arquivos") ---------- */
  function rid(){ try { return crypto.randomUUID(); } catch(e){ return Date.now().toString(36)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2); } }
  var assets = {
    upload: function(file, opts){
      opts = opts || {};
      if(file.size > 20*1024*1024) return Promise.reject({code:"too_large"});
      var ext = ((file.name||"").split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8) || "bin";
      var path = rid()+"."+ext, type = opts.type || file.type || "application/octet-stream";
      return SB.storage.from("arquivos").upload(path, file, {contentType:type, upsert:false}).then(function(r){
        if(r.error) throw {code: /exceed|too large|size/i.test(r.error.message||"") ? "too_large" : "unavailable", message:r.error.message};
        return {id:path, contentType:type, sizeBytes:file.size};
      });
    },
    delete: function(id){ return SB.storage.from("arquivos").remove([id]).then(function(){}); }
  };

  /* ---------- downloads: download comum do navegador ---------- */
  var downloads = {
    save: function(o){
      try {
        var blob = o.data instanceof Blob ? o.data : new Blob([o.data], {type: /\.pdf$/i.test(o.filename) ? "application/pdf" : "application/octet-stream"});
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = o.filename || "arquivo"; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
        return Promise.resolve({status:"saved"});
      } catch(e){ return Promise.reject({code:"unavailable", message:String(e)}); }
    }
  };

  window.claude = {
    use: function(name){
      return boot().then(function(){
        if(!SB) return null;
        if(name==="db") return db;
        if(name==="user") return user;
        if(name==="assets") return ADMIN ? assets : null;
        if(name==="downloads") return downloads;
        return null; // mcp (Google Agenda) e demais: indisponíveis fora do Claude
      });
    }
  };

  /* ---------- Login do mentor ---------- */
  function esc(t){ return String(t==null?"":t).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function box(){ var el = document.getElementById("fwgAuth"); if(!el){ el = document.createElement("div"); el.id = "fwgAuth"; document.body.appendChild(el); } return el; }
  function showLogin(modo, msg, ok){
    var go = function(){
      var el = box(); el.className = "on";
      var T = {
        entrar: '<h2>Acesso do mentor</h2><p class="s">Entre com o seu e-mail e senha.</p><form id="faF"><label>E-mail</label><input id="faE" type="email" autocomplete="username" required><label>Senha</label><input id="faS" type="password" autocomplete="current-password" required><button id="faB">Entrar</button></form><div class="lk"><a data-m="primeiro">Primeiro acesso</a><a data-m="esqueci">Esqueci a senha</a></div><div class="lk"><a data-m="fechar">‹ Ir para o Portal do Mentorado</a></div>',
        primeiro: '<h2>Primeiro acesso</h2><p class="s">Crie sua senha. Funciona apenas para e-mails de mentores cadastrados.</p><form id="faF"><label>E-mail</label><input id="faE" type="email" autocomplete="username" required><label>Crie uma senha (mín. 8 caracteres)</label><input id="faS" type="password" autocomplete="new-password" minlength="8" required><label>Repita a senha</label><input id="faS2" type="password" autocomplete="new-password" minlength="8" required><button id="faB">Criar acesso</button></form><div class="lk"><a data-m="entrar">‹ Voltar</a></div>',
        esqueci: '<h2>Recuperar senha</h2><p class="s">Enviaremos um link para você criar uma nova senha.</p><form id="faF"><label>E-mail</label><input id="faE" type="email" autocomplete="username" required><button id="faB">Enviar link</button></form><div class="lk"><a data-m="entrar">‹ Voltar</a></div>',
        nova: '<h2>Nova senha</h2><p class="s">Defina a nova senha de acesso.</p><form id="faF"><label>Nova senha (mín. 8 caracteres)</label><input id="faS" type="password" autocomplete="new-password" minlength="8" required><label>Repita a senha</label><input id="faS2" type="password" autocomplete="new-password" minlength="8" required><button id="faB">Salvar nova senha</button></form>'
      };
      el.innerHTML = '<div class="l"><div class="b"><svg viewBox="0 0 217 244" aria-hidden="true"><polygon fill="#BA9239" points="102,0 102,53 43,87 43,115 0,115 0,60"/><polygon fill="#F3F9FE" points="115,0 217,60 217,115 174,115 174,87 115,53"/><polygon fill="#F3F9FE" points="0,128 43,128 43,157 102,191 102,244 0,184"/><polygon fill="#F3F9FE" points="120,128 217,128 217,184 115,244 115,191 174,160"/></svg><span>framework<br>da <b>gestão</b></span></div><h1>Plataforma de <em>Mentorias</em></h1><p>Mentorados, agenda, plano de trabalho, Canvas FWG e financeiro em um só lugar.</p><small>Acesso restrito ao mentor.</small></div><div class="r"><div class="x">'+T[modo]+'<div class="m'+(msg?(ok?" ok":" er"):"")+'" id="faM">'+esc(msg||"")+'</div></div></div>';
      el.querySelectorAll("[data-m]").forEach(function(a){ a.onclick = function(){ if(a.dataset.m==="fechar"){ el.className=""; if(location.hash==="#mentor") history.replaceState(null,"",location.pathname); return; } showLogin(a.dataset.m); }; });
      var f = document.getElementById("faF"), M = function(t, okk){ var m = document.getElementById("faM"); m.className = "m "+(okk?"ok":"er"); m.textContent = t; }, B = document.getElementById("faB");
      f.onsubmit = function(e){
        e.preventDefault(); var sb = client(); B.disabled = true;
        var E = document.getElementById("faE"), email = E ? E.value.trim().toLowerCase() : "", s1 = document.getElementById("faS") ? document.getElementById("faS").value : "", s2 = document.getElementById("faS2") ? document.getElementById("faS2").value : s1;
        var back = location.origin + location.pathname;
        var done = function(){ location.hash = ""; location.reload(); };
        if(modo==="entrar") sb.auth.signInWithPassword({email:email, password:s1}).then(function(r){ B.disabled=false; if(r.error) return M(/confirm/i.test(r.error.message)?"Confirme seu e-mail pelo link que enviamos antes de entrar.":"E-mail ou senha incorretos."); done(); });
        else if(modo==="primeiro"){ if(s1!==s2){ B.disabled=false; return M("As senhas não conferem."); } sb.auth.signUp({email:email, password:s1, options:{emailRedirectTo:back}}).then(function(r){ B.disabled=false; if(r.error){ var m = r.error.message||""; return M(/already|registered|exists/i.test(m)?"Este e-mail já tem acesso. Use Entrar ou Esqueci a senha.":/database error|EMAIL_NAO_CADASTRADO|saving new user/i.test(m)?"Este e-mail não está cadastrado como mentor.":"Não foi possível criar o acesso: "+m); } if(r.data && r.data.session) return done(); showLogin("entrar", "Enviamos um e-mail de confirmação para "+email+". Clique no link e depois entre com sua senha.", true); }); }
        else if(modo==="esqueci") sb.auth.resetPasswordForEmail(email, {redirectTo:back}).then(function(){ B.disabled=false; M("Se este e-mail tiver acesso, você receberá um link para criar uma nova senha.", true); });
        else if(modo==="nova"){ if(s1!==s2){ B.disabled=false; return M("As senhas não conferem."); } sb.auth.updateUser({password:s1}).then(function(r){ B.disabled=false; if(r.error) return M("Não foi possível salvar: "+r.error.message); done(); }); }
      };
      setTimeout(function(){ var i = el.querySelector("input"); if(i) i.focus(); }, 30);
    };
    if(document.body) go(); else document.addEventListener("DOMContentLoaded", go);
  }
  window.FWG_HOSTED.showLogin = function(){ showLogin("entrar"); };
  window.FWG_HOSTED.sair = function(){ var sb = client(); (sb ? sb.auth.signOut() : Promise.resolve()).then(function(){ location.hash = ""; location.reload(); }); };
  window.FWG_HOSTED.trocarSenha = function(){ showLogin("nova"); };
  window.FWG_HOSTED.email = function(){ return user.email(); };
  boot().then(function(){ window.FWG_HOSTED.ready = true; });
})();
