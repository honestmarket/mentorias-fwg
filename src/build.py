"""Gera a versão hospedada (Netlify + Supabase) a partir dos arquivos da versão do Claude.

Uso: python3 src/build.py <pasta_da_versao_claude> site
A pasta de origem precisa ter index.html, canvas.html e vendor/.
O index.html é o MESMO da versão do Claude; aqui só entram a camada Supabase
(shim.js), a tela de login do mentor e textos que falam do Claude.
"""
import sys, os, shutil

src_dir, out_dir = sys.argv[1], sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(src_dir, 'index.html'), encoding='utf-8').read()

def R(a, b, cnt=1):
    global s
    n = s.count(a)
    assert n == cnt, (n, a[:90])
    s = s.replace(a, b)

# 1) cabeçalho: configuração + supabase-js + camada de capacidades (shim) + CSS do login
R('<title>Plataforma de Mentorias FWG</title>',
  '<title>Plataforma de Mentorias FWG</title>\n'
  '<script src="config.js"></script>\n'
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n'
  '<script src="shim.js"></script>\n'
  '<style>\n' + open(os.path.join(here, 'auth.css'), encoding='utf-8').read() + '\n</style>')

# 2) link do portal = endereço do próprio site
R('var PORTAL_URL = "https://claude.ai/artifact/GDHFwb4NsanXUT2XqcR9jy";',
  'var PORTAL_URL = location.origin + "/";')

# 3) instruções de acesso do mentorado (sem conta Claude)
i = s.index("'<li>Crie o usuário e a senha aqui.</li>")
j = s.index("</ol>", i)
s = s[:i] + "'<li>Crie o usuário e a senha aqui.</li><li>Envie ao mentorado o link do portal, o usuário e a senha (use “Copiar mensagem”).</li><li>Ele abre o link e entra direto com o usuário e a senha, sem precisar de nenhuma outra conta.</li>" + s[j:]
i = s.index('\\n\\nAo abrir o link, entre com a sua conta Claude')
j = s.index('";', i)
s = s[:i] + '\\n\\nÉ só abrir o link e entrar com o usuário e a senha acima.' + s[j:]

# 4) tela de login do portal: atalho para o login do mentor
R('''    '<div class="plerr" id="plErr">'+esc(msg||"")+'</div><button class="btn pri" id="plBtn" type="submit" style="justify-content:center;padding:12px">Entrar no portal</button>'+''',
  '''    '<div class="plerr" id="plErr">'+esc(msg||"")+'</div><button class="btn pri" id="plBtn" type="submit" style="justify-content:center;padding:12px">Entrar no portal</button>'+
    (!IS_MENTOR && window.FWG_HOSTED ? '<a href="#mentor" onclick="window.FWG_HOSTED.showLogin();return false" style="text-align:center;font-size:12.5px;color:var(--muted);margin-top:6px">Sou o mentor · entrar na plataforma</a>' : '')+''')

# 5) rodapé do menu: e-mail, trocar senha e sair
R('<div class="foot" id="sideFoot">',
  '<div class="foot" id="sideFoot"><div id="hostUser" style="margin-bottom:8px;font-size:11.5px;line-height:1.6"></div>')
R('''      mode = "carregando"; startDb();''',
  '''      mode = "carregando"; startDb();
      if(window.FWG_HOSTED && $("hostUser")) $("hostUser").innerHTML = '<span style="opacity:.75">'+esc(window.FWG_HOSTED.email())+'</span><br><a href="#" onclick="window.FWG_HOSTED.trocarSenha();return false" style="color:inherit">Trocar senha</a> · <a href="#" onclick="window.FWG_HOSTED.sair();return false" style="color:inherit">Sair</a>';''')

os.makedirs(out_dir, exist_ok=True)
open(os.path.join(out_dir, 'index.html'), 'w', encoding='utf-8').write(s)
shutil.copy(os.path.join(src_dir, 'canvas.html'), os.path.join(out_dir, 'canvas.html'))
os.makedirs(os.path.join(out_dir, 'vendor'), exist_ok=True)
for f in os.listdir(os.path.join(src_dir, 'vendor')):
    shutil.copy(os.path.join(src_dir, 'vendor', f), os.path.join(out_dir, 'vendor', f))
shutil.copy(os.path.join(here, 'shim.js'), os.path.join(out_dir, 'shim.js'))
print('ok', len(s))
