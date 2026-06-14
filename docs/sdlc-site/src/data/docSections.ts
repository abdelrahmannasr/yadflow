import type { ComponentType } from 'react';

// Curated yadflow doc sections. Each id is backed by a rewritten DocSection
// component (the exported function names are kept so imports resolve; their
// inner content is yadflow, not booking).
import { ExecutiveSummarySection } from '../components/DocSections/ExecutiveSummarySection';
import { FlowOverviewSection } from '../components/DocSections/FlowOverviewSection';
import { ApiReferenceSection } from '../components/DocSections/ApiReferenceSection';
import { StatusMachineSection } from '../components/DocSections/StatusMachineSection';
import { MiddlewareChainSection } from '../components/DocSections/MiddlewareChainSection';
import { DeploymentGuideSection } from '../components/DocSections/DeploymentGuideSection';
import { SecuritySection } from '../components/DocSections/SecuritySection';
import { PMRoadmapSection } from '../components/DocSections/PMRoadmapSection';
import { DataMigrationSection } from '../components/DocSections/DataMigrationSection';

export interface DocSectionConfig {
  id: string;
  title: string;
  icon: string;
  iconColor?: string;
  component: ComponentType;
}

export const DOC_SECTIONS: Record<string, DocSectionConfig> = {
  'executive-summary': {
    id: 'executive-summary',
    title: 'What yadflow Is',
    icon: 'dashboard',
    iconColor: '#2471a3',
    component: ExecutiveSummarySection,
  },
  'gated-flow': {
    id: 'gated-flow',
    title: 'The Gated Flow (setup → ship)',
    icon: 'route',
    iconColor: '#1e8449',
    component: FlowOverviewSection,
  },
  'review-gate': {
    id: 'review-gate',
    title: 'The Team Review Gate',
    icon: 'rate_review',
    iconColor: '#ca6f1e',
    component: ApiReferenceSection,
  },
  'contract-lock': {
    id: 'contract-lock',
    title: 'The Contract Lock',
    icon: 'lock',
    iconColor: '#566573',
    component: StatusMachineSection,
  },
  'two-dials': {
    id: 'two-dials',
    title: 'The Two Dials & Earned Automation',
    icon: 'tune',
    iconColor: '#b7950b',
    component: MiddlewareChainSection,
  },
  connectors: {
    id: 'connectors',
    title: 'Connectors',
    icon: 'cable',
    iconColor: '#2471a3',
    component: DeploymentGuideSection,
  },
  'check-gates': {
    id: 'check-gates',
    title: 'The Check Gates',
    icon: 'verified',
    iconColor: '#1e8449',
    component: SecuritySection,
  },
  'cli-reference': {
    id: 'cli-reference',
    title: 'The yad CLI',
    icon: 'terminal',
    iconColor: '#7d3c98',
    component: PMRoadmapSection,
  },
  glossary: {
    id: 'glossary',
    title: 'Glossary',
    icon: 'menu_book',
    iconColor: '#566573',
    component: DataMigrationSection,
  },
};
