-- AirReach P0 Client / Agency / Diagnosis schema (DRAFT)
-- DO NOT apply to production without explicit approval.
-- Maps to docs/airreach-p0-er.md

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agency', -- trillion | agency
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'seller', -- owner | seller | consultant
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  industry_id TEXT,
  primary_url TEXT,
  region_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_relationships (
  id UUID PRIMARY KEY,
  agency_organization_id UUID NOT NULL REFERENCES organizations(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  role TEXT NOT NULL DEFAULT 'seller',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agency_organization_id, client_id)
);

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  name TEXT,
  address_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  url TEXT NOT NULL,
  search_console_property TEXT,
  ga4_property_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'diagnosed', -- diagnosed | proposed | won | active | closed
  owner_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diagnoses (
  id TEXT PRIMARY KEY, -- public scan id
  project_id UUID REFERENCES projects(id),
  client_id UUID REFERENCES clients(id),
  site_url TEXT NOT NULL,
  industry_id TEXT,
  outcome_goal TEXT,
  auto_keyword TEXT,
  score_overall NUMERIC,
  evidence_summary_json JSONB,
  source TEXT NOT NULL DEFAULT 'airreach_free',
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diagnoses_client_idx ON diagnoses(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_client_idx ON projects(client_id, created_at DESC);
