// Sessão PIN validada no servidor. O bucket permanece privado e sem escrita pública.
const LIMITE = 10 * 1024 * 1024;
const BUCKET = 'notas-fiscais';
const origens = /^https:\/\/controle-compras-engmalls(?:-[a-z0-9-]+-rangel-s-projects2)?\.vercel\.app$/;
const chave = (grupo, legado) => {
  const atual = Deno.env.get(grupo);
  return (atual ? JSON.parse(atual).default : null) || Deno.env.get(legado);
};
const headersApi = key => ({ apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) });
const caminhoValido = path => typeof path === 'string' && /^\d+\/[a-f0-9-]{36}\.(png|jpg|webp|gif|avif|heic|heif)$/.test(path);
function formato(bytes) {
  const texto = new TextDecoder().decode(bytes);
  if (bytes.slice(0,8).every((v,i) => v === [137,80,78,71,13,10,26,10][i]) && bytes.length >= 8) return ['png','image/png'];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['jpg','image/jpeg'];
  if (texto.startsWith('GIF87a') || texto.startsWith('GIF89a')) return ['gif','image/gif'];
  if (texto.startsWith('RIFF') && texto.slice(8,12) === 'WEBP') return ['webp','image/webp'];
  if (texto.slice(4,8) === 'ftyp') {
    const marca = texto.slice(8,12);
    if (['avif','avis'].includes(marca)) return ['avif','image/avif'];
    if (['heic','heix','hevc','hevx'].includes(marca)) return ['heic','image/heic'];
    if (['mif1','msf1','heif'].includes(marca)) return ['heif','image/heif'];
  }
  return null;
}
Deno.serve(async request => {
  const origin = request.headers.get('origin');
  const cors = {
    'Access-Control-Allow-Origin': origin && origens.test(origin) ? origin : 'https://controle-compras-engmalls.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-eng-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin', 'Cache-Control': 'no-store'
  };
  const responder = (status, body) => new Response(JSON.stringify(body), {status, headers:{...cors,'Content-Type':'application/json'}});
  if (origin && !origens.test(origin)) return responder(403,{error:'Origem não permitida.'});
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
  if (request.method !== 'POST') return responder(405,{error:'Método não permitido.'});
  const token = request.headers.get('x-eng-session') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return responder(401,{error:'Sessão expirada. Entre novamente para anexar a imagem.'});
  try {
    const base = Deno.env.get('SUPABASE_URL');
    const anon = chave('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
    const secret = chave('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !anon || !secret) return responder(500,{error:'Serviço de anexos indisponível. Tente novamente mais tarde.'});
    const sessao = await fetch(`${base}/rest/v1/rpc/eng_sessao`, {
      method:'POST', headers:{...headersApi(anon),'Content-Type':'application/json','x-eng-session':token}, body:'{}'
    });
    if (!sessao.ok) return responder(503,{error:'Não foi possível validar a sessão. Tente novamente.'});
    const usuario = await sessao.json();
    if (!usuario?.id) return responder(401,{error:'Sessão expirada. Entre novamente para anexar a imagem.'});
    // Gera URL temporária somente para o dono ou para quem pode conferir compras.
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await request.json();
      if (body.action !== 'url' || !caminhoValido(body.path)) return responder(400,{error:'Anexo inválido.'});
      if (body.path.split('/')[0] !== String(usuario.id) && !usuario.is_master && !usuario.is_comprador)
        return responder(403,{error:'Sem permissão para acessar esta imagem.'});
      const assinatura = await fetch(`${base}/storage/v1/object/sign/${BUCKET}/${body.path}`, {
        method:'POST',headers:{...headersApi(secret),'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})
      });
      if (!assinatura.ok) return responder(404,{error:'Imagem não encontrada.'});
      const retorno = await assinatura.json();
      return responder(200,{url:`${base}/storage/v1${retorno.signedURL}`});
    }
    if (!request.headers.get('content-type')?.includes('multipart/form-data')) return responder(400,{error:'Selecione uma imagem para anexar.'});
    if (Number(request.headers.get('content-length')||0) > LIMITE + 65536) return responder(413,{error:'A imagem deve ter no máximo 10 MB.'});
    const form = await request.formData();
    const arquivo = form.get('arquivo');
    if (!(arquivo instanceof File) || !arquivo.size) return responder(400,{error:'Selecione uma imagem válida.'});
    if (arquivo.size > LIMITE) return responder(413,{error:'A imagem deve ter no máximo 10 MB.'});
    const tipo = formato(new Uint8Array(await arquivo.slice(0,16).arrayBuffer()));
    if (!tipo) return responder(400,{error:'Formato inválido. Use PNG, JPG, WEBP, GIF, AVIF ou HEIC.'});
    const path = `${usuario.id}/${crypto.randomUUID()}.${tipo[0]}`;
    const upload = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method:'POST',headers:{...headersApi(secret),'Content-Type':tipo[1],'x-upsert':'false'},body:arquivo
    });
    if (!upload.ok) return responder(502,{error:'Não foi possível enviar a imagem. Tente novamente.'});
    return responder(200,{path:`${BUCKET}/${path}`});
  } catch {
    return responder(500,{error:'Não foi possível processar a imagem. Tente novamente.'});
  }
});
