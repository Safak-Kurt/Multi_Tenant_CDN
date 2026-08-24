CREATE TABLE tenants (
    id UUID PRIMARY KEY,

    name VARCHAR(120) NOT NULL,

    slug VARCHAR(80) NOT NULL UNIQUE,

    bucket_name VARCHAR(63) NOT NULL UNIQUE,

    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
