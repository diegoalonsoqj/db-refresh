import { useSearchParams } from 'react-router-dom';
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
  // La pestaña va en la URL junto con la búsqueda/filtros/página de su listado;
  // al cambiar de pestaña se descartan los de la anterior.
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'projects';
  const setTab = (key) => setSp(key === 'projects' ? {} : { tab: key }, { replace: true });
  // Listas completas para los selects/vínculos y filtros (los paneles gestionan su propio CRUD).
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
