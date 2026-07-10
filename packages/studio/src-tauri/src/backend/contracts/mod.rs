//! Embedded, contracts-owned project-content validation.
//!
//! This module consumes only the generated artifacts tracked beside the Rust
//! crate. It never reads a project's `.galstudio/schemas` directory.
mod defaults;
mod diagnostics;
mod embedded;
mod policy;

pub(crate) use defaults::apply_schema_defaults;
pub(crate) use diagnostics::{validate_schema, ContractSchemaKind};
pub(crate) use embedded::{diagnostic, instruction_policies, instruction_types, schema};
pub(crate) use policy::validate_node_semantics;

#[cfg(test)]
mod tests;
