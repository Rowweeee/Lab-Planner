export interface Project {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
  arguments?: ProjectArgument[];
}

export interface ProjectArgument {
  id: number;
  project_id: number;
  content: string;
  created_at: string;
  planned_experiments?: string; // JSON string array
}

export interface Template {
  id: number;
  name: string;
  type: string;
  color: string;
  description: string;
  project_id: number | null;
}

export interface TemplateStep {
  id: number;
  template_id: number;
  day_offset: number;
  step_order: number;
  description: string;
  duration_minutes: number | null;
  notes: string | null;
}

export interface Experiment {
  id: number;
  name: string;
  template_id: number | null;
  start_date: string;
  status: 'planned' | 'in_progress' | 'completed' | 'failed';
  notes: string | null;
  color: string;
  template_name?: string;
  max_day_offset?: number;
  project_id: number | null;
  argument_id: number | null;
  project_name?: string;
  samples_json?: string;
}

export interface ExperimentStep {
  id: number;
  experiment_id: number;
  day_offset: number;
  step_order: number;
  description: string;
  is_completed: number;
  completed_at: string | null;
  notes: string | null;
}

export interface Record {
  id: number;
  experiment_id: number;
  purpose: string | null;
  results: string | null;
  summary: string | null;
  problems_json: string | null;
}
