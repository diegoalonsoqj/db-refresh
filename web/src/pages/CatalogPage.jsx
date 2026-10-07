import { useState } from 'react';
import { useList } from '../hooks/useList.js';
import ProjectsPanel from './catalog/ProjectsPanel.jsx';
import InstancesPanel from './catalog/InstancesPanel.jsx';
import BucketsPanel from './catalog/BucketsPanel.jsx';

const TABS = [
  { key: 'projects', label: 'Proyectos' },
  { key: 'instances', label: 'Instancias' },
  { key: 'buckets', label: 'Buckets' },
];

export default function CatalogPage() {
  const [tab, setTab] = useState('projects');
  // Listas compartidas para los selects/vínculos (los paneles gestionan su propio CRUD).
  const projectsL = useList('/projects');
  const bucketsL = useList('/buckets');
  const projects = projectsL.data ?? [];
  const buckets = bucketsL.data ?? [];

  return (
    <div className="page-fill">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'projects' && <ProjectsPanel onChange={projectsL.reload} />}
      {tab === 'instances' && <InstancesPanel projects={projects} buckets={buckets} />}
      {tab === 'buckets' && <BucketsPanel projects={projects} onChange={bucketsL.reload} />}
    </div>
  );
}
