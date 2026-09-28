(function initAnswerActions(global) {
  'use strict';

  function createAnswerActions(dependencies) {
    const choice = global.UwUKahootAIAnswerChoiceActions.create(dependencies);
    const { clickSubmitButton, ...choiceActions } = choice;
    const pinActions = global.UwUKahootAIAnswerPinActions.create(dependencies);
    const jumbleActions = global.UwUKahootAIAnswerJumbleActions.create({
      ...dependencies,
      clickSubmitButton
    });
    const textSliderActions = global.UwUKahootAIAnswerTextSliderActions.create(dependencies);

    return {
      ...choiceActions,
      ...pinActions,
      ...jumbleActions,
      ...textSliderActions
    };
  }

  global.UwUKahootAIAnswerActions = { create: createAnswerActions };
})(globalThis);
