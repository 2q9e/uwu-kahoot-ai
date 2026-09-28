window.WebSocket = function (url, protocols) {
  const ws = protocols ? new OldWebSocket(url, protocols) : new OldWebSocket(url);
  window.__kahootWS = ws;

  ws.addEventListener('message', function (event) {
    try {
      if (typeof event.data !== 'string') return;
      const data = JSON.parse(event.data);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.clientId && !window.kahootClientId) window.kahootClientId = item.clientId;
        if (item.data?.gameid && window.kahootGameId !== item.data.gameid) {
          window.kahootGameId = item.data.gameid;
          window.kahootQuestionIndex = 0;
          log('Joined game session');
        }
        if (item.id) {
          const msgId = parseInt(item.id, 10);
          if (!isNaN(msgId) && msgId > window.kahootMessageId) window.kahootMessageId = msgId;
        }
        if (item.data?.content) parseQuestionContent(item.data.content);
      }
    } catch (e) { console.debug(TAG, 'WS parse error:', e.message); }
  });

  ws.addEventListener('open', () => log('WS connected'));

  const origSend = ws.send.bind(ws);
  ws.send = function (data) {
    try {
      const parsed = JSON.parse(data);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item.data?.content) {
          const content = typeof item.data.content === 'string' ? JSON.parse(item.data.content) : item.data.content;
          if (content.type) log('WS OUT:', content.type);
        }
      }
    } catch (e) { console.debug(TAG, 'WS send parse error:', e.message); }
    return origSend(data);
  };

  ws.addEventListener('close', () => {
    log('WS closed');
    if (window.__kahootWS !== ws) return;
    window.__kahootWS = null;
    window.kahootClientId = null;
    window.kahootGameId = null;
    window.kahootQuestionIndex = 0;
    window.kahootMessageId = 0;
    window.dispatchEvent(new CustomEvent('kahootGameReset'));
  });

  return ws;
};

window.WebSocket.prototype = OldWebSocket.prototype;
Object.defineProperties(window.WebSocket, {
  CONNECTING: { value: 0 }, OPEN: { value: 1 }, CLOSING: { value: 2 }, CLOSED: { value: 3 }
});
