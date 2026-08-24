CREATE TABLE api_keys (
    id UUID PRIMARY KEY,

    tenant_id UUID NOT NULL
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    key_prefix VARCHAR(16) NOT NULL,

    key_hash CHAR(64) NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    last_used_at TIMESTAMPTZ,

    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_tenant_id
    ON api_keys(tenant_id);

CREATE INDEX idx_api_keys_active_tenant
    ON api_keys(tenant_id)
    WHERE revoked_at IS NULL;
