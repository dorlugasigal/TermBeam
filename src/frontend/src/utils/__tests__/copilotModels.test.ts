import { describe, it, expect } from 'vitest';
import { groupModels, vendorOf } from '../copilotModels';

const m = (id: string, name = id) => ({ id, name });

describe('vendorOf', () => {
  it('maps model ids to their vendor', () => {
    expect(vendorOf('claude-opus-5')).toBe('Anthropic');
    expect(vendorOf('gpt-5.3-codex')).toBe('OpenAI');
    expect(vendorOf('o3-mini')).toBe('OpenAI');
    expect(vendorOf('gemini-4-argon')).toBe('Google');
    expect(vendorOf('grok-4.7')).toBe('xAI');
    expect(vendorOf('mai-code-1.1-flash')).toBe('Microsoft');
    expect(vendorOf('mystery-1')).toBe('Other');
  });
});

describe('groupModels', () => {
  it('pulls auto out and groups by vendor in a fixed order', () => {
    const { auto, groups } = groupModels([
      m('grok-4.7', 'Grok 4.7'),
      m('gpt-5.5', 'GPT-5.5'),
      m('auto', 'Auto'),
      m('mystery-1'),
      m('claude-sonnet-5', 'Claude Sonnet 5'),
    ]);
    expect(auto).toEqual(m('auto', 'Auto'));
    expect(groups.map((g) => g.label)).toEqual(['Anthropic', 'OpenAI', 'xAI', 'Other']);
  });

  it('puts the newest generation first, then sorts by name', () => {
    const { groups } = groupModels([
      m('claude-haiku-4.5', 'Claude Haiku 4.5'),
      m('claude-opus-5', 'Claude Opus 5'),
      m('claude-sonnet-5.5', 'Claude Sonnet 5.5'),
      m('claude-opus-4.8', 'Claude Opus 4.8'),
      m('claude-opus-5.5', 'Claude Opus 5.5'),
      m('claude-sonnet-5', 'Claude Sonnet 5'),
    ]);
    expect(groups[0]?.models.map((x) => x.name)).toEqual([
      'Claude Opus 5.5',
      'Claude Sonnet 5.5',
      'Claude Opus 5',
      'Claude Sonnet 5',
      'Claude Opus 4.8',
      'Claude Haiku 4.5',
    ]);
  });

  it('orders a base model before its variants and point releases above majors', () => {
    const { groups } = groupModels([
      m('gpt-5-mini', 'GPT-5 mini'),
      m('gpt-5.4-mini', 'GPT-5.4 mini'),
      m('gpt-6.1-sol', 'GPT-6.1 Sol'),
      m('gpt-5.4', 'GPT-5.4'),
      m('gpt-6-sol', 'GPT-6 Sol'),
      m('codex', 'Codex'),
    ]);
    expect(groups[0]?.models.map((x) => x.name)).toEqual([
      'GPT-6.1 Sol',
      'GPT-6 Sol',
      'GPT-5.4',
      'GPT-5.4 mini',
      'GPT-5 mini',
      'Codex',
    ]);
  });

  it('handles an empty list', () => {
    expect(groupModels([])).toEqual({ auto: null, groups: [] });
  });
});
