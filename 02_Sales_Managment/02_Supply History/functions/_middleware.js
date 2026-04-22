export async function onRequest(context) {
  const request = context.request;

  // 👇 여기에 원하는 아이디와 비밀번호를 입력해!
  const USERNAME = "kng"; 
  const PASSWORD = "2833";

  const authHeader = request.headers.get("Authorization");
  const expectedAuth = "Basic " + btoa(`${USERNAME}:${PASSWORD}`);

  // 비밀번호가 틀리거나 없으면 팝업창을 띄우는 역할
  if (!authHeader || authHeader !== expectedAuth) {
    return new Response("인증이 필요합니다.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="K&G Secure Area"',
      },
    });
  }

  // 인증 성공 시 원래 페이지(index.html)를 보여줌
  return context.next();
}