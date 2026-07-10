use super::transition_asset_scope;
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};

#[test]
fn asset_scope_transition_revokes_previous_project_before_allowing_next() {
    let project_a = PathBuf::from("/projects/a/content");
    let project_b = PathBuf::from("/projects/b/content");
    let mut active = Some(project_a.clone());
    let operations = RefCell::new(Vec::new());

    transition_asset_scope(
        &mut active,
        project_b.clone(),
        |path: &Path| {
            operations
                .borrow_mut()
                .push(format!("forbid:{}", path.display()));
            Ok(())
        },
        |path: &Path| {
            operations
                .borrow_mut()
                .push(format!("allow:{}", path.display()));
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(
        operations.into_inner(),
        vec![
            "forbid:/projects/a/content".to_string(),
            "allow:/projects/b/content".to_string(),
        ]
    );
    assert_eq!(active, Some(project_b));
}

#[test]
fn asset_scope_transition_is_idempotent_for_the_active_content_root() {
    let content = PathBuf::from("/projects/a/content");
    let mut active = Some(content.clone());
    let operation_count = Cell::new(0);

    transition_asset_scope(
        &mut active,
        content.clone(),
        |_| {
            operation_count.set(operation_count.get() + 1);
            Ok(())
        },
        |_| {
            operation_count.set(operation_count.get() + 1);
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(operation_count.get(), 0);
    assert_eq!(active, Some(content));
}

#[test]
fn asset_scope_transition_restores_previous_scope_when_next_allow_fails() {
    let project_a = PathBuf::from("/projects/a/content");
    let project_b = PathBuf::from("/projects/b/content");
    let mut active = Some(project_a.clone());
    let operations = RefCell::new(Vec::new());

    let error = transition_asset_scope(
        &mut active,
        project_b.clone(),
        |path: &Path| {
            operations
                .borrow_mut()
                .push(format!("forbid:{}", path.display()));
            Ok(())
        },
        |path: &Path| {
            operations
                .borrow_mut()
                .push(format!("allow:{}", path.display()));
            if path == project_b {
                Err("allow failed".to_string())
            } else {
                Ok(())
            }
        },
    )
    .expect_err("the failed next scope must be reported");

    assert_eq!(error, "allow failed");
    assert_eq!(
        operations.into_inner(),
        vec![
            "forbid:/projects/a/content".to_string(),
            "allow:/projects/b/content".to_string(),
            "allow:/projects/a/content".to_string(),
        ]
    );
    assert_eq!(active, Some(project_a));
}
