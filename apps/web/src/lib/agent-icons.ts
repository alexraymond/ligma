import {
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Code,
  Database,
  Globe,
  HeartPulse,
  Megaphone,
  Palette,
  Scale,
  Search,
  Shield,
  User,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Map of known icon names to Lucide components */
const iconMap: Record<string, LucideIcon> = {
  User,
  Search,
  Code,
  Megaphone,
  BarChart3,
  Bot,
  Brain,
  Palette,
  Shield,
  Database,
  Globe,
  Wrench,
  BookOpen,
  HeartPulse,
  Scale,
  Briefcase,
};

/** Built-in agent ID → default icon */
const builtInAgentIcons: Record<string, LucideIcon> = {
  me: User,
  researcher: Search,
  developer: Code,
  marketer: Megaphone,
  'business-analyst': BarChart3,
};

/**
 * Get the Lucide icon component for an agent.
 * Checks the agent's icon name first, falls back to built-in defaults, then Bot.
 */
export function getAgentIcon(agentId: string, iconName?: string): LucideIcon {
  if (iconName && iconMap[iconName]) return iconMap[iconName];
  return builtInAgentIcons[agentId] ?? Bot;
}

/** Get a Lucide icon by name string, with fallback */
export function getIconByName(name: string): LucideIcon {
  return iconMap[name] ?? Bot;
}
