// Caption style picker sheet used by CameraPage when previewing a moment.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { clock, overlayStyle } from '../../lib/format.js';
import { ui } from '../../ui/overlays.jsx';

let presetsCache = null;

export function StylePicker({ onPick }) {
  const [presets, setPresets] = useState(presetsCache);
  useEffect(() => {
    if (presetsCache) return;
    api.captions().then((d) => { presetsCache = d.presets; setPresets(d.presets); }).catch((err) => ui.error(err.message));
  }, []);
  if (!presets) return <div className="empty"><span className="spinner" style={{ margin: '0 auto' }} /></div>;
  const sections = new Map();
  presets.forEach((p) => {
    const key = p.section || 'Khác';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(p);
  });
  return (
    <div className="styles">
      <div className="sheet-title">Kiểu chú thích</div>
      <div className="chips" style={{ marginTop: 12 }}><button type="button" className="chip" onClick={() => onPick(null)}>Aa&nbsp; Văn bản</button></div>
      {[...sections].map(([name, list]) => (
        <div key={name}>
          <h4>{name}</h4>
          <div className="chips">
            {list.map((p) => (
              <button type="button" key={p.key} className="chip" style={overlayStyle(p)} onClick={() => onPick(p)}>
                {p.icon ? <span>{p.icon}</span> : null}{p.type === 'time' ? clock(Date.now()) : p.text}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
