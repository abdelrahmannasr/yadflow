import type { ComponentType } from 'react';

// New DocSection components
import { ExecutiveSummarySection } from '../components/DocSections/ExecutiveSummarySection';
import { FlowOverviewSection } from '../components/DocSections/FlowOverviewSection';
import { ApiReferenceSection } from '../components/DocSections/ApiReferenceSection';
import { StatusMachineSection } from '../components/DocSections/StatusMachineSection';
import { MiddlewareChainSection } from '../components/DocSections/MiddlewareChainSection';
import { DeploymentGuideSection } from '../components/DocSections/DeploymentGuideSection';
import { CriticalRunbookSection } from '../components/DocSections/CriticalRunbookSection';
import { DataMigrationSection } from '../components/DocSections/DataMigrationSection';
import { PerformanceTestingSection } from '../components/DocSections/PerformanceTestingSection';
import { PMRoadmapSection } from '../components/DocSections/PMRoadmapSection';
import { MonitoringAlertingSection } from '../components/DocSections/MonitoringAlertingSection';
import { SecuritySection } from '../components/DocSections/SecuritySection';
import { NotificationLocalizationSection } from '../components/DocSections/NotificationLocalizationSection';
import { DbSchemaSection } from '../components/DocSections/DbSchemaSection';
import { TestPlanSection } from '../components/DocSections/TestPlanSection';
import { FlowPathsChecklistSection } from '../components/DocSections/FlowPathsChecklistSection';
import { RiderIntegrationSection } from '../components/DocSections/RiderIntegrationSection';
import { DriverIntegrationSection } from '../components/DocSections/DriverIntegrationSection';
import { CancelabilitySection } from '../components/DocSections/CancelabilitySection';

// Existing Reference components (reused as doc sections)
import { DecisionTreeView } from '../components/Reference/DecisionTreeView';
import { RiderUIStatesTable } from '../components/Reference/RiderUIStatesTable';
import { DriverUIStatesTable } from '../components/Reference/DriverUIStatesTable';
import { BullMQJobsList } from '../components/Reference/BullMQJobsList';
import { FeatureFlagMatrix } from '../components/Reference/FeatureFlagMatrix';
import { DeeplinkActionsChips } from '../components/Reference/DeeplinkActionsChips';
import { TroubleshootingSection } from '../components/Reference/TroubleshootingSection';

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
    title: 'Executive Summary',
    icon: 'dashboard',
    iconColor: '#7b59e6',
    component: ExecutiveSummarySection,
  },
  'flow-overview': {
    id: 'flow-overview',
    title: 'Flow Paths Overview',
    icon: 'route',
    iconColor: '#06b6d4',
    component: FlowOverviewSection,
  },
  'rider-integration': {
    id: 'rider-integration',
    title: 'Rider Integration Guide',
    icon: 'phone_iphone',
    iconColor: '#7b59e6',
    component: RiderIntegrationSection,
  },
  'driver-integration': {
    id: 'driver-integration',
    title: 'Driver Integration Guide',
    icon: 'directions_car',
    iconColor: '#06b6d4',
    component: DriverIntegrationSection,
  },
  'rider-ui-states': {
    id: 'rider-ui-states',
    title: 'Rider UI States',
    icon: 'phone_iphone',
    iconColor: '#10b981',
    component: RiderUIStatesTable,
  },
  'driver-ui-states': {
    id: 'driver-ui-states',
    title: 'Driver UI States',
    icon: 'directions_car',
    iconColor: '#06b6d4',
    component: DriverUIStatesTable,
  },
  'api-reference': {
    id: 'api-reference',
    title: 'API Reference',
    icon: 'api',
    iconColor: '#f59e0b',
    component: ApiReferenceSection,
  },
  'status-machine': {
    id: 'status-machine',
    title: 'Status Machine & Transitions',
    icon: 'swap_horiz',
    iconColor: '#ec4899',
    component: StatusMachineSection,
  },
  'middleware-chain': {
    id: 'middleware-chain',
    title: 'Middleware Chain',
    icon: 'link',
    iconColor: '#8b5cf6',
    component: MiddlewareChainSection,
  },
  'decision-tree': {
    id: 'decision-tree',
    title: 'Decision Tree (handleBookAssigned)',
    icon: 'account_tree',
    iconColor: '#7b59e6',
    component: DecisionTreeView,
  },
  'bullmq-jobs': {
    id: 'bullmq-jobs',
    title: 'BullMQ Jobs',
    icon: 'schedule',
    iconColor: '#a855f7',
    component: BullMQJobsList,
  },
  'feature-flags': {
    id: 'feature-flags',
    title: 'Feature Flags',
    icon: 'flag',
    iconColor: '#f59e0b',
    component: FeatureFlagMatrix,
  },
  deeplinks: {
    id: 'deeplinks',
    title: 'Deeplink Actions',
    icon: 'link',
    iconColor: '#06b6d4',
    component: DeeplinkActionsChips,
  },
  'notification-localization': {
    id: 'notification-localization',
    title: 'Notifications & Localization',
    icon: 'notifications',
    iconColor: '#fb2576',
    component: NotificationLocalizationSection,
  },
  cancelability: {
    id: 'cancelability',
    title: 'Cancelability Rules',
    icon: 'gavel',
    iconColor: '#ef4444',
    component: CancelabilitySection,
  },
  'error-codes': {
    id: 'error-codes',
    title: 'Error Codes & Troubleshooting',
    icon: 'warning',
    iconColor: '#fbbf24',
    component: TroubleshootingSection,
  },
  troubleshooting: {
    id: 'troubleshooting',
    title: 'Troubleshooting Guide',
    icon: 'build',
    iconColor: '#f97316',
    component: TroubleshootingSection,
  },
  deployment: {
    id: 'deployment',
    title: 'Deployment Guide',
    icon: 'rocket_launch',
    iconColor: '#22c55e',
    component: DeploymentGuideSection,
  },
  'critical-runbook': {
    id: 'critical-runbook',
    title: 'Critical Runbook',
    icon: 'local_fire_department',
    iconColor: '#ef4444',
    component: CriticalRunbookSection,
  },
  'data-migration': {
    id: 'data-migration',
    title: 'Data Migration',
    icon: 'sync_alt',
    iconColor: '#8b5cf6',
    component: DataMigrationSection,
  },
  security: {
    id: 'security',
    title: 'Security & Access Control',
    icon: 'shield',
    iconColor: '#22c55e',
    component: SecuritySection,
  },
  'performance-testing': {
    id: 'performance-testing',
    title: 'Performance Testing',
    icon: 'speed',
    iconColor: '#06b6d4',
    component: PerformanceTestingSection,
  },
  'pm-roadmap': {
    id: 'pm-roadmap',
    title: 'Product Roadmap',
    icon: 'timeline',
    iconColor: '#f59e0b',
    component: PMRoadmapSection,
  },
  'monitoring-alerting': {
    id: 'monitoring-alerting',
    title: 'Monitoring & Alerting',
    icon: 'monitoring',
    iconColor: '#fb2576',
    component: MonitoringAlertingSection,
  },
  'db-schema': {
    id: 'db-schema',
    title: 'Database Schema',
    icon: 'storage',
    iconColor: '#10b981',
    component: DbSchemaSection,
  },
  'test-plan': {
    id: 'test-plan',
    title: 'Test Plan',
    icon: 'checklist',
    iconColor: '#ef4444',
    component: TestPlanSection,
  },
  'flow-paths-checklist': {
    id: 'flow-paths-checklist',
    title: 'Flow Paths Checklist',
    icon: 'playlist_add_check',
    iconColor: '#22c55e',
    component: FlowPathsChecklistSection,
  },
};
