import { useCallback, useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { ReportView } from './ReportView';
import { AskAnalyst } from './AskAnalyst';
import { date } from './format';
import './insights.css';
import { apiUrl } from '../api';

async function api(path) {
  const response = await fetch(apiUrl(path));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: response.status });
  return data;
}

export async function downloadFile(path, filename) {
  const response = await fetch(apiUrl(path));
  if (!response.ok) throw new Error('Export failed. Try again.');
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Showcase version: a public page over the published studies (the synthetic demo study). The company portal and
// its email sign-in are not part of this deployment.
function Studies({ onOpen }) {
  const [studies, setStudies] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/insights/studies').then(setStudies).catch(e => setError(e.message)); }, []);
  if (error) return <p className="hi-error" role="alert">{error}</p>;
  if (!studies) return <p role="status" className="hi-muted">Loading studies…</p>;
  if (!studies.length) return <div className="hi-empty"><h2>No studies yet.</h2><p>Load the demo study with <code>npm run seed</code>, or set <code>HUNCH_SEED_DEMO=on</code>, then refresh.</p></div>;
  return <section className="hi-studies"><h1>What shoppers <em>think</em> things cost.</h1>
    <p className="hi-lede">Anonymous price-perception research from people playing Hunch, with an AI analyst you can question. The demo study uses synthetic respondents.</p>
    {studies.map(s => <button key={s.id} className="hi-study" onClick={() => onOpen(s)}>
      <span className="hi-eyebrow">{s.client} · {s.status === 'active' ? 'COLLECTING' : 'CLOSED'} · {date(s.startsOn)} – {date(s.endsOn)}</span>
      <strong>{s.title}</strong>
      <span className="hi-progress" aria-label={`${s.responses} of ${s.minResponses} target responses`}><span style={{ width: `${Math.min(100, (s.responses / s.minResponses) * 100)}%` }} /></span>
      <span className="hi-muted">{s.responses} responses from {s.respondents} people · target {s.minResponses} · {s.products} products</span>
    </button>)}
  </section>;
}

function StudyReport({ study, onBack }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); api(`/api/insights/studies/${study.id}/report`).then(setReport).catch(e => setError(e.message)); }, [study.id]);
  useEffect(load, [load]);
  if (error) return <p className="hi-error" role="alert">{error}</p>;
  if (!report) return <p role="status" className="hi-muted">Building the report…</p>;
  return <ReportView report={report} title={report.study.title} subtitle={`${report.study.responses} of ${report.study.minResponses} target responses collected.`}
    assistant={<AskAnalyst study={study} />}
    actions={<>
      <button className="hi-button hi-button-quiet" onClick={onBack}>← All studies</button>
      <button className="hi-button hi-button-quiet" onClick={load}>Refresh</button>
      <button className="hi-button hi-button-quiet" onClick={() => downloadFile(`/api/insights/studies/${study.id}/report.csv`, `hunch-insights-study-${study.id}.csv`).catch(e => setError(e.message))}>Export CSV (aggregates)</button>
      <button className="hi-button" onClick={() => window.print()}>Print / save PDF</button>
    </>} />;
}

export function InsightsApp() {
  const [study, setStudy] = useState(null);
  const { theme, toggleTheme } = useTheme();
  useEffect(() => { document.title = 'Hunch Insights'; }, []);
  return <div className="hunch-insights">
    <header className="app-header">
      <a href="/" className="header-brand" title="Back to Hunch home">
        <span className="brand-mark" aria-hidden="true">H</span>
        <span className="brand-name">Hunch <em>Insights</em></span>
      </a>
      <div className="header-actions">
        <button onClick={toggleTheme} className="header-icon-btn" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </header>
    <main className="hi-main">{study ? <StudyReport study={study} onBack={() => setStudy(null)} /> : <Studies onOpen={setStudy} />}</main>
  </div>;
}
