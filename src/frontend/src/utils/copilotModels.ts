import type { CopilotModel } from '@/services/api';

export interface ModelGroup {
  label: string;
  models: CopilotModel[];
}

const VENDORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^claude/i, 'Anthropic'],
  [/^(gpt|o\d|codex)/i, 'OpenAI'],
  [/^gemini/i, 'Google'],
  [/^grok/i, 'xAI'],
  [/^(mai|phi)/i, 'Microsoft'],
];
const GROUP_ORDER = [...VENDORS.map(([, label]) => label), 'Other'];

export function vendorOf(id: string): string {
  return VENDORS.find(([re]) => re.test(id))?.[1] ?? 'Other';
}

/** `claude-opus-4.8` → [4, 8]; ids without a version sort last. */
function versionOf(id: string): number[] {
  const match = id.match(/\d+(?:\.\d+)*/);
  return match ? match[0].split('.').map(Number) : [];
}

function compareModels(a: CopilotModel, b: CopilotModel): number {
  const va = versionOf(a.id);
  const vb = versionOf(b.id);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (vb[i] ?? -1) - (va[i] ?? -1);
    if (diff) return diff;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

/**
 * Shape a model list for a picker: `auto` on its own, then one group per
 * vendor with the newest generation first, so new releases land on top
 * without anyone maintaining an order.
 */
export function groupModels(models: CopilotModel[]): {
  auto: CopilotModel | null;
  groups: ModelGroup[];
} {
  const auto = models.find((m) => m.id === 'auto') ?? null;
  const byVendor = new Map<string, CopilotModel[]>();
  for (const model of models) {
    if (model.id === 'auto') continue;
    const label = vendorOf(model.id);
    const list = byVendor.get(label) ?? [];
    list.push(model);
    byVendor.set(label, list);
  }
  const groups = GROUP_ORDER.filter((label) => byVendor.has(label)).map((label) => ({
    label,
    models: [...byVendor.get(label)!].sort(compareModels),
  }));
  return { auto, groups };
}
