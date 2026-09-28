function makePayload(contentObj) {
  const { kahootGameId: gameid, kahootClientId: clientId } = window;
  window.kahootMessageId++;
  return [{
    id: String(window.kahootMessageId),
    channel: '/service/controller',
    data: {
      gameid, type: 'message', host: 'kahoot.it',
      id: window.kahootDataId,
      content: JSON.stringify(contentObj)
    },
    clientId, ext: {}
  }];
}

function wsSend(payload) {
  const ws = window.__kahootWS;
  if (!ws || ws.readyState !== OldWebSocket.OPEN || !window.kahootGameId || !window.kahootClientId) {
    warn('Cannot send - WS not ready');
    return false;
  }
  ws.send(JSON.stringify(payload));
  return true;
}
