import Anthropic from '@anthropic-ai/sdk';
import { AiTransientError, toTransient } from './ai-classifier.service.js';

describe('toTransient com erros REAIS do SDK', () => {
  it('APIConnectionError → transitório', () => {
    const e = new Anthropic.APIConnectionError({ cause: new Error('socket hang up') });
    expect(toTransient(e)).toBeInstanceOf(AiTransientError);
  });

  it('APIConnectionTimeoutError → transitório', () => {
    expect(toTransient(new Anthropic.APIConnectionTimeoutError())).toBeInstanceOf(AiTransientError);
  });

  it('erro HTTP 429 e 400 continuam como antes', () => {
    expect(toTransient({ status: 429, message: 'x' })).toBeInstanceOf(AiTransientError);
    expect(toTransient({ status: 400, message: 'x' })).toBeNull();
  });

  it('Error comum sem status/nome de conexão não é transitório', () => {
    expect(toTransient(new Error('resposta fora do formato'))).toBeNull();
  });
});
