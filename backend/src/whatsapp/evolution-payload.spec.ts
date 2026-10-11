import { parseEvolutionMessage } from './evolution-payload.js';

const base = (over: Record<string, any> = {}, key: Record<string, any> = {}) => ({
  event: 'messages.upsert',
  instance: 'os',
  data: {
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'ABC123', participant: '5519999991234@s.whatsapp.net', ...key },
    pushName: 'Fulano',
    message: { conversation: 'Sistema caiu - 3 PCs' },
    messageType: 'conversation',
    messageTimestamp: 1760000000,
    ...over,
  },
});

describe('parseEvolutionMessage', () => {
  it('mensagem de texto em grupo', () => {
    const m = parseEvolutionMessage(base())!;
    expect(m).toMatchObject({
      externalId: '120363000000000001@g.us:ABC123',
      groupJid: '120363000000000001@g.us',
      senderPhone: '5519999991234',
      senderName: 'Fulano',
      type: 'TEXT',
      body: 'Sistema caiu - 3 PCs',
    });
    expect(m.sentAt.getTime()).toBe(1760000000 * 1000);
  });

  it('aceita o nome do evento em MAIÚSCULAS com underline', () => {
    expect(parseEvolutionMessage({ ...base(), event: 'MESSAGES_UPSERT' })).not.toBeNull();
  });

  it('extendedTextMessage e data como array', () => {
    const p = base({ message: { extendedTextMessage: { text: 'Sem conexão' } } });
    const m = parseEvolutionMessage({ ...p, data: [p.data] })!;
    expect(m.body).toBe('Sem conexão');
    expect(m.type).toBe('TEXT');
  });

  it('ignora: outro evento, conversa individual, fromMe, sem id', () => {
    expect(parseEvolutionMessage({ ...base(), event: 'connection.update' })).toBeNull();
    expect(parseEvolutionMessage(base({}, { remoteJid: '5519999991234@s.whatsapp.net' }))).toBeNull();
    expect(parseEvolutionMessage(base({}, { fromMe: true }))).toBeNull();
    expect(parseEvolutionMessage(base({}, { id: undefined }))).toBeNull();
    expect(parseEvolutionMessage(null)).toBeNull();
    expect(parseEvolutionMessage('x')).toBeNull();
  });

  it('áudio e imagem viram tipo próprio; legenda da imagem vira body', () => {
    expect(parseEvolutionMessage(base({ message: { audioMessage: { seconds: 3 } } }))!).toMatchObject({ type: 'AUDIO', body: null });
    expect(parseEvolutionMessage(base({ message: { imageMessage: { caption: 'olha isso' } } }))!).toMatchObject({ type: 'IMAGE', body: 'olha isso' });
    expect(parseEvolutionMessage(base({ message: { stickerMessage: {} } }))!).toMatchObject({ type: 'OTHER', body: null });
  });

  it('remetente LID sem telefone: grava a mensagem com senderPhone vazio', () => {
    const m = parseEvolutionMessage(base({}, { participant: '99887766554433@lid' }))!;
    expect(m.senderPhone).toBe('');
  });

  it('LID com participantPn: usa o telefone real', () => {
    const m = parseEvolutionMessage(base({}, { participant: '99887766554433@lid', participantPn: '5519999991234@s.whatsapp.net' }))!;
    expect(m.senderPhone).toBe('5519999991234');
  });

  it('timestamp em objeto {low} e timestamp ausente', () => {
    expect(parseEvolutionMessage(base({ messageTimestamp: { low: 1760000001, high: 0 } }))!.sentAt.getTime()).toBe(1760000001 * 1000);
    expect(parseEvolutionMessage(base({ messageTimestamp: undefined }))!.sentAt).toBeInstanceOf(Date);
  });

  it('desembrulha ephemeralMessage e viewOnceMessageV2', () => {
    const e = parseEvolutionMessage(base({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'Sistema caiu' } } } } }))!;
    expect(e.body).toBe('Sistema caiu');
    expect(e.type).toBe('TEXT');
    const v = parseEvolutionMessage(base({ message: { viewOnceMessageV2: { message: { imageMessage: { caption: 'foto' } } } } }))!;
    expect(v.body).toBe('foto');
    expect(v.type).toBe('IMAGE');
  });

  it('remetente: participantPn vazio ou LID não esconde participant válido', () => {
    expect(parseEvolutionMessage(base({}, { participantPn: '' }))!.senderPhone).toBe('5519999991234');
    expect(parseEvolutionMessage(base({}, { participantPn: '99887766554433@lid' }))!.senderPhone).toBe('5519999991234');
  });

  it('payload malformado devolve null sem lançar', () => {
    for (const p of [{ event: 'messages.upsert', data: [] }, base({}, {}) && { event: 'messages.upsert', data: { key: null } }, base({ message: 'x' })]) {
      expect(() => parseEvolutionMessage(p)).not.toThrow();
    }
    expect(parseEvolutionMessage({ event: 'messages.upsert', data: [] })).toBeNull();
    expect(parseEvolutionMessage({ event: 'messages.upsert', data: { key: null } })).toBeNull();
    expect(parseEvolutionMessage(base({ message: 'x' }))!.type).toBe('OTHER');
  });
});
