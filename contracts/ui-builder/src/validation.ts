import type { VektreUIDocumentV2 } from './document.js';
import type { DocumentPatchProposal, JsonPatchOperation } from './patches.js';

export interface ContractValidationIssue {
  code: string;
  path: string;
  message: string;
  relatedIds: string[];
}

export interface DocumentValidationLimits {
  maxNodes: number;
  maxNestingDepth: number;
  maxTextLength: number;
  maxReferencesPerNode: number;
  maxPatchOperations: number;
}

export const DEFAULT_DOCUMENT_LIMITS: DocumentValidationLimits = {
  maxNodes: 10000,
  maxNestingDepth: 64,
  maxTextLength: 50000,
  maxReferencesPerNode: 2048,
  maxPatchOperations: 4096,
};

function addIssue(
  issues: ContractValidationIssue[],
  code: string,
  path: string,
  message: string,
  relatedIds: string[] = [],
): void {
  issues.push({ code, path, message, relatedIds });
}

function validateRecordIds(
  issues: ContractValidationIssue[],
  root: string,
  values: Record<string, { id: string }>,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (key !== value.id) {
      addIssue(
        issues,
        'record_key_id_mismatch',
        `/${root}/${key}/id`,
        `Record key "${key}" does not match embedded id "${value.id}"`,
        [key, value.id],
      );
    }
  }
}

export function validateVektreUIDocument(
  document: VektreUIDocumentV2,
  limits: DocumentValidationLimits = DEFAULT_DOCUMENT_LIMITS,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  const recordRoots = [
    ['platformProfiles', document.platformProfiles],
    ['spatialProfiles', document.spatialProfiles],
    ['screens', document.screens],
    ['surfaces', document.surfaces],
    ['flows', document.flows],
    ['groups', document.groups],
    ['components', document.components],
    ['blockDefinitions', document.blockDefinitions],
    ['blockInstances', document.blockInstances],
    ['styles', document.styles],
    ['assets', document.assets],
    ['bindings', document.bindings],
    ['states', document.states],
    ['interactions', document.interactions],
    ['visibilityRules', document.visibilityRules],
    ['animations', document.animations],
    ['constraints', document.constraints],
  ] as const;

  for (const [root, values] of recordRoots) {
    validateRecordIds(issues, root, values);
  }

  const nodeCount =
    Object.keys(document.groups).length +
    Object.keys(document.components).length +
    Object.keys(document.blockInstances).length;
  if (nodeCount > limits.maxNodes) {
    addIssue(
      issues,
      'node_limit_exceeded',
      '/',
      `Document has ${nodeCount} nodes; maximum is ${limits.maxNodes}`,
    );
  }

  const allNodeIds = new Set([
    ...Object.keys(document.groups),
    ...Object.keys(document.components),
    ...Object.keys(document.blockInstances),
  ]);
  const embeddedNodeIds = [
    ...Object.values(document.groups).map((node) => node.id),
    ...Object.values(document.components).map((node) => node.id),
    ...Object.values(document.blockInstances).map((node) => node.id),
  ];
  if (new Set(embeddedNodeIds).size !== embeddedNodeIds.length) {
    addIssue(
      issues,
      'duplicate_semantic_id',
      '/',
      'Group, component, and block-instance IDs must be globally unique',
    );
  }

  for (const [screenId, screen] of Object.entries(document.screens)) {
    for (const surfaceId of screen.surfaceIds) {
      if (!document.surfaces[surfaceId]) {
        addIssue(
          issues,
          'missing_surface',
          `/screens/${screenId}/surfaceIds`,
          `Screen references missing surface "${surfaceId}"`,
          [screenId, surfaceId],
        );
      }
    }
    for (const root of screen.rootNodes) {
      const expectedCollection =
        root.kind === 'group'
          ? document.groups
          : root.kind === 'component'
            ? document.components
            : document.blockInstances;
      const node = expectedCollection[root.id];
      if (!node) {
        addIssue(
          issues,
          'missing_root_node',
          `/screens/${screenId}/rootNodes`,
          `Screen references missing ${root.kind} root "${root.id}"`,
          [screenId, root.id],
        );
      } else if (node.parentId) {
        addIssue(
          issues,
          'root_has_parent',
          `/screens/${screenId}/rootNodes`,
          `Root node "${root.id}" also declares parent "${node.parentId}"`,
          [screenId, root.id, node.parentId],
        );
      }
    }
    if (screen.initialStateId && !document.states[screen.initialStateId]) {
      addIssue(
        issues,
        'missing_initial_state',
        `/screens/${screenId}/initialStateId`,
        `Screen references missing initial state "${screen.initialStateId}"`,
        [screenId, screen.initialStateId],
      );
    }
  }

  for (const [surfaceId, surface] of Object.entries(document.surfaces)) {
    for (const profileId of surface.platformProfileIds) {
      if (!document.platformProfiles[profileId]) {
        addIssue(
          issues,
          'missing_platform_profile',
          `/surfaces/${surfaceId}/platformProfileIds`,
          `Surface references missing platform profile "${profileId}"`,
          [surfaceId, profileId],
        );
      }
    }
    if (
      surface.spatialProfileId &&
      !document.spatialProfiles[surface.spatialProfileId]
    ) {
      addIssue(
        issues,
        'missing_spatial_profile',
        `/surfaces/${surfaceId}/spatialProfileId`,
        `Surface references missing spatial profile "${surface.spatialProfileId}"`,
        [surfaceId, surface.spatialProfileId],
      );
    }
  }

  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (!document.screens[flow.entryScreenId]) {
      addIssue(
        issues,
        'missing_entry_screen',
        `/flows/${flowId}/entryScreenId`,
        `Flow entry screen "${flow.entryScreenId}" does not exist`,
        [flowId, flow.entryScreenId],
      );
    }
    for (const screenId of flow.screenIds) {
      if (!document.screens[screenId]) {
        addIssue(
          issues,
          'missing_flow_screen',
          `/flows/${flowId}/screenIds`,
          `Flow references missing screen "${screenId}"`,
          [flowId, screenId],
        );
      }
    }
  }

  const parentById = new Map<string, string | undefined>();
  for (const [id, node] of [
    ...Object.entries(document.groups),
    ...Object.entries(document.components),
    ...Object.entries(document.blockInstances),
  ]) {
    parentById.set(id, node.parentId);
    if (!document.screens[node.screenId]) {
      addIssue(
        issues,
        'missing_node_screen',
        `/${document.groups[id] ? 'groups' : document.components[id] ? 'components' : 'blockInstances'}/${id}/screenId`,
        `Node references missing screen "${node.screenId}"`,
        [id, node.screenId],
      );
    }
    if (!document.surfaces[node.surfaceId]) {
      addIssue(
        issues,
        'missing_node_surface',
        `/${document.groups[id] ? 'groups' : document.components[id] ? 'components' : 'blockInstances'}/${id}/surfaceId`,
        `Node references missing surface "${node.surfaceId}"`,
        [id, node.surfaceId],
      );
    }
    if (node.parentId && !document.groups[node.parentId]) {
      addIssue(
        issues,
        'invalid_parent',
        `/${document.groups[id] ? 'groups' : document.components[id] ? 'components' : 'blockInstances'}/${id}/parentId`,
        `Parent "${node.parentId}" must reference an existing group`,
        [id, node.parentId],
      );
    }
  }

  for (const id of parentById.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = id;
    let depth = 0;
    while (current) {
      if (seen.has(current)) {
        addIssue(
          issues,
          'parent_cycle',
          '/',
          `Node parent cycle includes "${current}"`,
          [...seen, current],
        );
        break;
      }
      seen.add(current);
      current = parentById.get(current);
      depth += 1;
      if (depth > limits.maxNestingDepth) {
        addIssue(
          issues,
          'nesting_limit_exceeded',
          '/',
          `Node "${id}" exceeds nesting depth ${limits.maxNestingDepth}`,
          [id],
        );
        break;
      }
    }
  }

  for (const [groupId, group] of Object.entries(document.groups)) {
    if (group.children.length > limits.maxReferencesPerNode) {
      addIssue(
        issues,
        'reference_limit_exceeded',
        `/groups/${groupId}/children`,
        `Group exceeds ${limits.maxReferencesPerNode} child references`,
        [groupId],
      );
    }
    for (const child of group.children) {
      const exists =
        child.kind === 'group'
          ? document.groups[child.id]
          : child.kind === 'component'
            ? document.components[child.id]
            : document.blockInstances[child.id];
      if (!exists) {
        addIssue(
          issues,
          'missing_child',
          `/groups/${groupId}/children`,
          `Group references missing ${child.kind} "${child.id}"`,
          [groupId, child.id],
        );
      } else if (exists.parentId !== groupId) {
        addIssue(
          issues,
          'child_parent_mismatch',
          `/groups/${groupId}/children`,
          `Child "${child.id}" does not point back to parent "${groupId}"`,
          [groupId, child.id],
        );
      }
    }
  }

  for (const [componentId, component] of Object.entries(document.components)) {
    const refs: Array<
      [string, readonly string[] | undefined, Record<string, unknown>]
    > = [
      ['assetIds', component.assetIds, document.assets],
      ['bindingIds', component.bindingIds, document.bindings],
      ['stateIds', component.stateIds, document.states],
      ['interactionIds', component.interactionIds, document.interactions],
      [
        'visibilityRuleIds',
        component.visibilityRuleIds,
        document.visibilityRules,
      ],
    ];
    for (const [field, ids, target] of refs) {
      for (const id of ids ?? []) {
        if (!target[id]) {
          addIssue(
            issues,
            'dangling_reference',
            `/components/${componentId}/${field}`,
            `Component references missing "${id}"`,
            [componentId, id],
          );
        }
      }
    }
    if (component.styleId && !document.styles[component.styleId]) {
      addIssue(
        issues,
        'dangling_reference',
        `/components/${componentId}/styleId`,
        `Component references missing style "${component.styleId}"`,
        [componentId, component.styleId],
      );
    }
  }

  for (const [instanceId, instance] of Object.entries(
    document.blockInstances,
  )) {
    const definition = document.blockDefinitions[instance.definitionId];
    if (!definition || definition.version !== instance.definitionVersion) {
      addIssue(
        issues,
        'missing_block_version',
        `/blockInstances/${instanceId}/definitionId`,
        `Block definition "${instance.definitionId}" version ${instance.definitionVersion} is unavailable`,
        [instanceId, instance.definitionId],
      );
    }
  }

  for (const [definitionId, definition] of Object.entries(
    document.blockDefinitions,
  )) {
    validateRecordIds(
      issues,
      `blockDefinitions/${definitionId}/nodes`,
      definition.nodes,
    );
    validateRecordIds(
      issues,
      `blockDefinitions/${definitionId}/parameters`,
      definition.parameters,
    );
    for (const rootId of definition.rootNodeIds) {
      const root = definition.nodes[rootId];
      if (!root) {
        addIssue(
          issues,
          'missing_block_root',
          `/blockDefinitions/${definitionId}/rootNodeIds`,
          `Block definition references missing root "${rootId}"`,
          [definitionId, rootId],
        );
      } else if (root.parentId) {
        addIssue(
          issues,
          'block_root_has_parent',
          `/blockDefinitions/${definitionId}/rootNodeIds`,
          `Block root "${rootId}" also declares parent "${root.parentId}"`,
          [definitionId, rootId, root.parentId],
        );
      }
    }

    const blockParents = new Map<string, string | undefined>();
    for (const [nodeId, node] of Object.entries(definition.nodes)) {
      blockParents.set(nodeId, node.parentId);
      if (node.kind === 'component' && !node.componentKind) {
        addIssue(
          issues,
          'missing_component_kind',
          `/blockDefinitions/${definitionId}/nodes/${nodeId}/componentKind`,
          'Block component template requires componentKind',
          [definitionId, nodeId],
        );
      }
      if (node.kind === 'group' && node.componentKind) {
        addIssue(
          issues,
          'unexpected_component_kind',
          `/blockDefinitions/${definitionId}/nodes/${nodeId}/componentKind`,
          'Block group template cannot declare componentKind',
          [definitionId, nodeId],
        );
      }
      if (node.parentId && !definition.nodes[node.parentId]) {
        addIssue(
          issues,
          'missing_block_parent',
          `/blockDefinitions/${definitionId}/nodes/${nodeId}/parentId`,
          `Block node references missing parent "${node.parentId}"`,
          [definitionId, nodeId, node.parentId],
        );
      }
      for (const childId of node.children) {
        const child = definition.nodes[childId];
        if (!child) {
          addIssue(
            issues,
            'missing_block_child',
            `/blockDefinitions/${definitionId}/nodes/${nodeId}/children`,
            `Block node references missing child "${childId}"`,
            [definitionId, nodeId, childId],
          );
        } else if (child.parentId !== nodeId) {
          addIssue(
            issues,
            'block_child_parent_mismatch',
            `/blockDefinitions/${definitionId}/nodes/${nodeId}/children`,
            `Block child "${childId}" does not point back to "${nodeId}"`,
            [definitionId, nodeId, childId],
          );
        }
      }
      for (const parameterId of Object.keys(node.parameterBindings ?? {})) {
        if (!definition.parameters[parameterId]) {
          addIssue(
            issues,
            'missing_block_parameter',
            `/blockDefinitions/${definitionId}/nodes/${nodeId}/parameterBindings/${parameterId}`,
            `Block node references missing parameter "${parameterId}"`,
            [definitionId, nodeId, parameterId],
          );
        }
      }
    }

    for (const nodeId of blockParents.keys()) {
      const seen = new Set<string>();
      let current: string | undefined = nodeId;
      while (current) {
        if (seen.has(current)) {
          addIssue(
            issues,
            'block_parent_cycle',
            `/blockDefinitions/${definitionId}/nodes`,
            `Block parent cycle includes "${current}"`,
            [definitionId, ...seen, current],
          );
          break;
        }
        seen.add(current);
        current = blockParents.get(current);
      }
    }
  }

  for (const [interactionId, interaction] of Object.entries(
    document.interactions,
  )) {
    if (
      interaction.targetId &&
      !allNodeIds.has(interaction.targetId) &&
      !document.screens[interaction.targetId] &&
      !document.states[interaction.targetId]
    ) {
      addIssue(
        issues,
        'missing_interaction_target',
        `/interactions/${interactionId}/targetId`,
        `Interaction references missing target "${interaction.targetId}"`,
        [interactionId, interaction.targetId],
      );
    }
  }

  for (const [animationId, animation] of Object.entries(document.animations)) {
    if (!allNodeIds.has(animation.targetId)) {
      addIssue(
        issues,
        'missing_animation_target',
        `/animations/${animationId}/targetId`,
        `Animation references missing node "${animation.targetId}"`,
        [animationId, animation.targetId],
      );
    }
  }

  for (const [constraintId, constraint] of Object.entries(
    document.constraints,
  )) {
    for (const targetId of constraint.targetIds) {
      if (!allNodeIds.has(targetId)) {
        addIssue(
          issues,
          'missing_constraint_target',
          `/constraints/${constraintId}/targetIds`,
          `Constraint references missing node "${targetId}"`,
          [constraintId, targetId],
        );
      }
    }
  }

  const serialized = JSON.stringify(document);
  if (serialized.length > limits.maxTextLength * Math.max(1, nodeCount)) {
    addIssue(
      issues,
      'document_size_limit_exceeded',
      '/',
      'Serialized document exceeds the configured size budget',
    );
  }

  return issues;
}

function isMutatingOperation(
  operation: JsonPatchOperation,
): operation is Exclude<JsonPatchOperation, { op: 'test' }> {
  return operation.op !== 'test';
}

export function validateDocumentPatchProposal(
  proposal: DocumentPatchProposal,
  limits: DocumentValidationLimits = DEFAULT_DOCUMENT_LIMITS,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  if (proposal.operations.length > limits.maxPatchOperations) {
    addIssue(
      issues,
      'patch_limit_exceeded',
      '/operations',
      `Patch has ${proposal.operations.length} operations; maximum is ${limits.maxPatchOperations}`,
    );
  }

  const testedPaths = new Set<string>();
  for (const [index, operation] of proposal.operations.entries()) {
    if (operation.op === 'test') {
      testedPaths.add(operation.path);
      continue;
    }
    if (
      isMutatingOperation(operation) &&
      operation.op !== 'add' &&
      !testedPaths.has(operation.path)
    ) {
      addIssue(
        issues,
        'missing_patch_precondition',
        `/operations/${index}/path`,
        `Mutation of "${operation.path}" requires an earlier test operation`,
      );
    }
    if (operation.op === 'move' && !testedPaths.has(operation.from)) {
      addIssue(
        issues,
        'missing_patch_precondition',
        `/operations/${index}/from`,
        `Move source "${operation.from}" requires an earlier test operation`,
      );
    }
  }

  return issues;
}
