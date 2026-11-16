import React from 'react'
import type { Branch } from '../hooks/useWorkspace'

const labelClass = 'text-[10px] font-bold text-outline uppercase tracking-wider block mb-1.5'

/** Chọn nhiều cơ sở (phân công người dùng, giáo viên, ngày nghỉ) */
export default function BranchChecklist({ branches, value, onChange, label }: { branches: Branch[]; value: string[]; onChange: (ids: string[]) => void; label: string }) {
  const options = branches.filter(b => b.isActive || value.includes(b.id))
  return (
    <fieldset>
      <legend className={labelClass}>{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(b => (
          <label key={b.id} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer ${value.includes(b.id) ? 'border-primary bg-primary/5 text-primary font-semibold' : 'border-outline-variant/30 text-on-surface'}`}>
            <input type="checkbox" checked={value.includes(b.id)} onChange={e => onChange(e.target.checked ? [...value, b.id] : value.filter(id => id !== b.id))} />
            {b.name}{!b.isActive && ' (ngừng)'}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
