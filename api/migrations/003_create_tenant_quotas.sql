CREATE TABLE tenant_quotas (
    tenant_id UUID PRIMARY KEY
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    storage_limit_bytes BIGINT NOT NULL
        CHECK (storage_limit_bytes >= 0),

    bandwidth_limit_bytes BIGINT NOT NULL
        CHECK (bandwidth_limit_bytes >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
