'use client';

import { useId, useState } from 'react';
import { Search } from 'lucide-react';
import { searchLanguages, type LanguageOption } from '@/shared/languages';
import styles from './language-select.module.css';

export function LanguageSelect({ label, value, options, disabled, onChange }: {
  label: string; value: string; options: LanguageOption[]; disabled: boolean; onChange: (code: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const filtered = searchLanguages(options, query);
  const selected = options.find(option => option.code === value);

  const isInput = label.toLowerCase().includes('đầu vào');
  const primaryCodes = ['auto', 'vi-VN', 'ja-JP', 'en-US'];
  const primaryOptions = primaryCodes
    .map(code => options.find(opt => opt.code === code))
    .filter((opt): opt is LanguageOption => Boolean(opt));
  const otherOptions = options.filter(opt => !primaryCodes.includes(opt.code));

  return <div className={styles.field}>
    <div className={styles.labelRow}><label htmlFor={id}>{label}</label>
      <button type="button" aria-label={`Tìm ${label.toLowerCase()}`} aria-expanded={searching} aria-controls={`${id}-search`} disabled={disabled}
        onClick={() => { setSearching(value => !value); setQuery(''); }}><Search size={14} /></button></div>
    {searching && <input id={`${id}-search`} type="search" aria-label={`Từ khóa ${label.toLowerCase()}`} placeholder="Tìm tên hoặc mã…"
      disabled={disabled} value={query} autoFocus onChange={event => setQuery(event.target.value)} />}
    <select id={id} value={value} disabled={disabled} onChange={event => { onChange(event.target.value); setQuery(''); setSearching(false); }}>
      {selected && !filtered.some(option => option.code === value) && <option value={value}>{selected.name} {value === 'none' || value === 'auto' ? '' : `· ${value}`}</option>}
      {!selected && <option value={value}>Chọn ngôn ngữ · {value}</option>}
      {isInput && !searching && primaryOptions.length > 0 ? (
        <>
          <optgroup label="Ngôn ngữ chính">
            {primaryOptions.map(option => <option key={option.code} value={option.code}>{option.name}</option>)}
          </optgroup>
          <optgroup label="Tùy chọn ngôn ngữ khác">
            {otherOptions.map(option => <option key={option.code} value={option.code}>{option.name} · {option.code}</option>)}
          </optgroup>
        </>
      ) : (
        filtered.map(option => <option key={option.code} value={option.code}>{option.name} {option.code === 'none' || option.code === 'auto' ? '' : `· ${option.code}`}</option>)
      )}
    </select>
    {query ? <small role="status">{filtered.length} kết quả / {options.length} lựa chọn</small> : null}
  </div>;
}

