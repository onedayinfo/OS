import { getPath, renderTemplate, truncateStrings } from './template.util.js';

const UNIFI = {
  alarm: {
    name: 'Device Update Status',
    triggers: [{ key: 'device_update', device: 'AA:BB:CC', eventId: 'ev1' }],
    eventLocalLink: 'https://192.168.1.10/protect/events/event/ev1',
  },
  timestamp: 1763300000000,
};

describe('getPath', () => {
  it('navega objetos e índices de lista', () => {
    expect(getPath(UNIFI, 'alarm.name')).toBe('Device Update Status');
    expect(getPath(UNIFI, 'alarm.triggers.0.device')).toBe('AA:BB:CC');
    expect(getPath(UNIFI, 'alarm.triggers.5.device')).toBeUndefined();
    expect(getPath(UNIFI, 'alarm.name.x')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });
});

describe('renderTemplate', () => {
  it('mistura texto fixo com marcadores (com ou sem espaços)', () => {
    expect(renderTemplate('Câmera {{ alarm.triggers.0.device }}: {{alarm.name}}', UNIFI)).toBe(
      'Câmera AA:BB:CC: Device Update Status',
    );
  });

  it('ausente vira vazio, número vira texto, objeto vira JSON', () => {
    expect(renderTemplate('{{nao.existe}}', UNIFI)).toBe('');
    expect(renderTemplate('{{timestamp}}', UNIFI)).toBe('1763300000000');
    expect(renderTemplate('{{alarm.triggers.0}}', UNIFI)).toBe(
      '{"key":"device_update","device":"AA:BB:CC","eventId":"ev1"}',
    );
  });

  it('marcadores todos ausentes → vazio mesmo com texto fixo; algum presente → mantém', () => {
    expect(renderTemplate('UniFi: {{x.y}} ({{x.z}})', UNIFI)).toBe('');
    expect(renderTemplate('UniFi: {{alarm.name}} ({{x.z}})', UNIFI)).toBe('UniFi: Device Update Status ()');
    expect(renderTemplate('Texto fixo', UNIFI)).toBe('Texto fixo');
  });

  it('modelo vazio/nulo → vazio', () => {
    expect(renderTemplate(null, UNIFI)).toBe('');
    expect(renderTemplate('', UNIFI)).toBe('');
  });
});

describe('truncateStrings', () => {
  it('corta strings longas em qualquer profundidade e mantém o resto', () => {
    const big = 'x'.repeat(2000);
    const out = truncateStrings({ a: big, b: [{ c: big, d: 1 }], e: 'curto' }, 10) as any;
    expect(out.a).toBe('xxxxxxxxxx… [2000 caracteres]');
    expect(out.b[0].c.startsWith('xxxxxxxxxx…')).toBe(true);
    expect(out.b[0].d).toBe(1);
    expect(out.e).toBe('curto');
  });
});
