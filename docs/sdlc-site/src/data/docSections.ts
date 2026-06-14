import type { ComponentType } from 'react';

// Curated yadflow doc sections. Each id is backed by a DocSection component
// whose file + exported function name match the section it renders.
import { ExecutiveSummarySection } from '../components/DocSections/ExecutiveSummarySection';
import { FlowOverviewSection } from '../components/DocSections/FlowOverviewSection';
import { ReviewGateSection } from '../components/DocSections/ReviewGateSection';
import { ContractLockSection } from '../components/DocSections/ContractLockSection';
import { TwoDialsSection } from '../components/DocSections/TwoDialsSection';
import { ConnectorsSection } from '../components/DocSections/ConnectorsSection';
import { CheckGatesSection } from '../components/DocSections/CheckGatesSection';
import { CliReferenceSection } from '../components/DocSections/CliReferenceSection';
import { GlossarySection } from '../components/DocSections/GlossarySection';

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
    component: ReviewGateSection,
  },
  'contract-lock': {
    id: 'contract-lock',
    title: 'The Contract Lock',
    icon: 'lock',
    iconColor: '#566573',
    component: ContractLockSection,
  },
  'two-dials': {
    id: 'two-dials',
    title: 'The Two Dials & Earned Automation',
    icon: 'tune',
    iconColor: '#b7950b',
    component: TwoDialsSection,
  },
  connectors: {
    id: 'connectors',
    title: 'Connectors',
    icon: 'cable',
    iconColor: '#2471a3',
    component: ConnectorsSection,
  },
  'check-gates': {
    id: 'check-gates',
    title: 'The Check Gates',
    icon: 'verified',
    iconColor: '#1e8449',
    component: CheckGatesSection,
  },
  'cli-reference': {
    id: 'cli-reference',
    title: 'The yad CLI',
    icon: 'terminal',
    iconColor: '#7d3c98',
    component: CliReferenceSection,
  },
  glossary: {
    id: 'glossary',
    title: 'Glossary',
    icon: 'menu_book',
    iconColor: '#566573',
    component: GlossarySection,
  },
};
