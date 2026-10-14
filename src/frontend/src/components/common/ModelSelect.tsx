import { useMemo, type SelectHTMLAttributes } from 'react';
import { useCopilotModels } from '@/stores/copilotModelsStore';
import { groupModels } from '@/utils/copilotModels';

interface ModelSelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange' | 'children'
> {
  value: string;
  onChange: (model: string) => void;
  /** Label for "" (let Copilot choose its default); omit to leave that choice out. */
  defaultLabel?: string;
}

/**
 * Native picker over the live Copilot model list — native so phones get the
 * system wheel. A value missing from the list (a retired model, or one the
 * list hasn't loaded yet) is still shown rather than silently swapped.
 */
export function ModelSelect({
  value,
  onChange,
  defaultLabel,
  onFocus,
  ...props
}: ModelSelectProps) {
  const { models, status, refresh } = useCopilotModels();
  const { auto, groups } = useMemo(() => groupModels(models), [models]);
  const listed = value === '' || models.some((m) => m.id === value);

  return (
    <select
      {...props}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // Opening the picker retries a failed load or refreshes a stale list.
      onFocus={(e) => {
        refresh();
        onFocus?.(e);
      }}
    >
      {defaultLabel !== undefined ? (
        <option value="">{defaultLabel}</option>
      ) : (
        value === '' && (
          <option value="" disabled>
            {status === 'loading' ? 'Loading models…' : 'Copilot default'}
          </option>
        )
      )}
      {!listed && <option value={value}>{value}</option>}
      {auto && <option value={auto.id}>{auto.name}</option>}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
