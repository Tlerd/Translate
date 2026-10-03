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
  return <div className={styles.field}>
    <div className={styles.labelRow}><label htmlFor={id}>{label}</label>
      <button type="button" aria-label={`Tìm ${label.toLowerCase()}`} aria-expanded={searching} aria-controls={`${id}-search`} disabled={disabled}
        onClick={() => { setSearching(value => !value); setQuery(''); }}><Search size={15} /></button></div>
    {searching && <input id={`${id}-search`} type="search" aria-label={`Từ khóa ${label.toLowerCase()}`} placeholder="Tìm tên hoặc mã…"
      disabled={disabled} value={query} autoFocus onChange={event => setQuery(event.target.value)} />}
    <select id={id} value={value} disabled={disabled} onChange={event => { onChange(event.target.value); setQuery(''); setSearching(false); }}>
      {selected && !filtered.some(option => option.code === value) && <option value={value}>{selected.name} · {value}</option>}
      {!selected && <option value={value}>Chọn ngôn ngữ · {value}</option>}
      {filtered.map(option => <option key={option.code} value={option.code}>{option.name} · {option.code}</option>)}
    </select>
    <small role="status">{query ? `${filtered.length} kết quả / ` : ''}{options.length} lựa chọn</small>
  </div>;
}
