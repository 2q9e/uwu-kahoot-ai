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

function sendAnswerOverWebSocket(content) {
  const questionType = content.type;
  let sent = false;
  try {
    sent = wsSend(makePayload(content));
  } catch (error) {
    warn(`${questionType} answer send failed`, error?.name || 'Error');
  }
  window.dispatchEvent(new CustomEvent('kahootAnswerDispatchResult', {
    detail: {
      sent,
      questionType,
      questionIndex: content.questionIndex ?? window.kahootQuestionIndex
    }
  }));
  return sent;
}
