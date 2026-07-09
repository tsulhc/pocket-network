export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Access Restricted — Pocket Provider Dashboard</title>
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0f;
      color: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    main {
      max-width: 480px;
      padding: 40px;
      text-align: center;
      border: 1px solid #1f1f2e;
      border-radius: 12px;
      background: #0f0f18;
    }
    h1 {
      font-size: 1.5rem;
      margin: 0 0 8px;
    }
    p {
      color: #888;
      font-size: 0.95rem;
      line-height: 1.6;
    }
    form {
      margin-top: 24px;
      display: flex;
      gap: 8px;
    }
    input {
      flex: 1;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid #1f1f2e;
      background: #0a0a0f;
      color: #f0f0f0;
      font-size: 0.95rem;
    }
    button {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      background: #00c2ff;
      color: #0a0a0f;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main>
    <h1>Access Restricted</h1>
    <p>This dashboard contains private provider intelligence and is protected by an access token. Enter your access key below or contact your administrator.</p>
    <form method="get" action="/">
      <input name="auth" type="password" placeholder="Access token" required autofocus />
      <button type="submit">Access</button>
    </form>
  </main>
</body>
</html>`,
    {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}
