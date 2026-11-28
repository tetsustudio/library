'use client';

import { useEffect, useState } from 'react';
import { resolveLabels, type EditorLabels } from '../labels.js';
import { getSpellcheck, type SpellcheckController } from '../spellcheck/controller.js';
import { SPELLCHECK_LANGUAGES, type SpellcheckLanguage } from '../spellcheck/settings.js';
import type { EditorStorage } from '../storage.js';
import { Icon } from './icons.js';

export interface SpellcheckSettingsProps {
  open: boolean;
  onClose: () => void;
  /** The controller the editors use. Without it, the shared one for `storage`/`storagePrefix`/`dictionaryBaseUrl`. */
  spellcheck?: SpellcheckController;
  storage?: EditorStorage;
  storagePrefix?: string;
  dictionaryBaseUrl?: string;
  labels?: Partial<EditorLabels>;
}

function ToggleRow({ label, description, checked, disabled, onChange }: { label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="ted-settings__row" data-disabled={disabled ? 'true' : undefined}>
      <div className="ted-settings__text">
        <span>{label}</span>
        {description && <span className="ted-settings__hint">{description}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="ted-switch">
        <span className="ted-switch__thumb" />
      </button>
    </div>
  );
}

/**
 * Spellcheck settings dialog: on/off, auto-accent, language and the ignored
 * words. Changes apply at once to every mounted editor sharing the controller.
 */
export function SpellcheckSettings({ open, onClose, spellcheck: given, storage, storagePrefix, dictionaryBaseUrl, labels: labelOverrides }: SpellcheckSettingsProps) {
  const labels = resolveLabels(labelOverrides);
  const spellcheck = given ?? getSpellcheck({ storage, storagePrefix, dictionaryBaseUrl });
  const [enabled, setEnabled] = useState(true);
  const [language, setLanguage] = useState<SpellcheckLanguage>('es');
  const [autoAccent, setAutoAccent] = useState(false);
  const [ignoredWords, setIgnoredWords] = useState<string[]>([]);

  // Re-read on every open: another tab may have changed them.
  useEffect(() => {
    if (!open) return;
    const settings = spellcheck.getSettings();
    setEnabled(settings.enabled);
    setLanguage(settings.language);
    setAutoAccent(settings.autoAccent);
    setIgnoredWords(spellcheck.getIgnoredWords(settings.language));
  }, [open, spellcheck]);

  if (!open) return null;

  return (
    <div className="ted-modal">
      <div className="ted-modal__backdrop" onClick={onClose} />
      <div className="ted-modal__panel" role="dialog" aria-modal="true" aria-label={labels.spellcheckTitle}>
        <div className="ted-modal__header">
          <div className="ted-modal__title">
            <Icon name="spellCheck" />
            <h2>{labels.spellcheckTitle}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={labels.close} className="ted-icon-button">
            <Icon name="x" />
          </button>
        </div>

        <ToggleRow
          label={labels.spellcheckEnabled}
          checked={enabled}
          onChange={(next) => {
            setEnabled(next);
            spellcheck.setEnabled(next);
          }}
        />
        <ToggleRow
          label={labels.autoAccent}
          description={labels.autoAccentDescription}
          checked={autoAccent}
          disabled={!enabled}
          onChange={(next) => {
            setAutoAccent(next);
            spellcheck.setAutoAccent(next);
          }}
        />
        <div className="ted-settings__row">
          <span>{labels.language}</span>
          <select
            value={language}
            disabled={!enabled}
            aria-label={labels.language}
            className="ted-select"
            onChange={(event) => {
              const next = event.target.value as SpellcheckLanguage;
              setLanguage(next);
              spellcheck.setLanguage(next);
              setIgnoredWords(spellcheck.getIgnoredWords(next));
            }}
          >
            {SPELLCHECK_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {labels.languageNames[code]}
              </option>
            ))}
          </select>
        </div>

        <div className="ted-settings__words">
          <span>{labels.ignoredWords}</span>
          {ignoredWords.length === 0 ? (
            <p className="ted-settings__hint">{labels.noIgnoredWords}</p>
          ) : (
            <ul className="ted-settings__list">
              {ignoredWords.map((word) => (
                <li key={word}>
                  <span>{word}</span>
                  <button
                    type="button"
                    aria-label={labels.unignoreWord(word)}
                    className="ted-icon-button"
                    onClick={() => {
                      spellcheck.removePersonalWord(language, word);
                      setIgnoredWords((previous) => previous.filter((w) => w !== word));
                    }}
                  >
                    <Icon name="x" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
