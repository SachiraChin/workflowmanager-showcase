"""
Enrich Transform Module - Merge enrichment data into nested structures using schema-based mapping

A generic module that takes a nested data structure and an array of enrichments,
then merges enrichment values into matching objects based on a declarative mapping schema
that mirrors the target document hierarchy.
"""

from typing import Dict, Any, List, Set
from copy import deepcopy
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class EnrichModule(ExecutableModule):
    """
    Merge enrichment data into nested structures using schema-based mapping.

    The mapping schema mirrors the target document hierarchy and specifies
    which fields to enrich and how to match them with enrichment data.

    Example mapping schema:
        {
            "type": "object",
            "properties": {
                "aesthetic_concepts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "aesthetic_quick_summary": {
                                "type": "enrichment_map",
                                "document_data_id_field": "id",
                                "enrichment_data_id_field": "id",
                                "source_field": "generated_summary"
                            },
                            "ideas": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "idea_quick_summary": {
                                            "type": "enrichment_map",
                                            "document_data_id_field": "id",
                                            "enrichment_data_id_field": "id",
                                            "source_field": "generated_summary"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

    Enrichment map fields:
        - type: Must be "enrichment_map"
        - document_data_id_field: Field in the data object to use as lookup key
        - enrichment_data_id_field: Field in enrichments to match against
        - source_field: Field in enrichments to copy value from

    Example enrichments:
        [
            {"id": "1", "generated_summary": "Summary for aesthetic 1..."},
            {"id": "1_1", "generated_summary": "Summary for idea 1_1..."}
        ]

    Inputs:
        - data: The nested data structure to enrich
        - enrichments: Array of enrichment objects
        - mapping_schema: Schema defining the document hierarchy and field mappings

    Outputs:
        - enriched_data: The data structure with enrichments merged in

    Errors:
        - Throws if any enrichment ID has no match in data (unused enrichment)
        - Throws if duplicate IDs found in enrichments for same enrichment_data_id_field
        - Throws if any data object at enrichment point has no corresponding enrichment
    """

    @property
    def module_id(self) -> str:
        return "transform.enrich"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="data",
                type="object",
                required=True,
                description="The nested data structure to enrich"
            ),
            ModuleInput(
                name="enrichments",
                type="array",
                required=True,
                description="Array of enrichment objects"
            ),
            ModuleInput(
                name="mapping_schema",
                type="object",
                required=True,
                description="Schema defining document hierarchy and field mappings"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="enriched_data",
                type="object",
                description="The data structure with enrichments merged in"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Enrich data by merging enrichments based on schema-defined mappings"""
        try:
            data = inputs['data']
            enrichments = inputs['enrichments']
            mapping_schema = inputs['mapping_schema']

            # Validate inputs
            if not isinstance(enrichments, list):
                raise ModuleExecutionError(
                    self.module_id,
                    "enrichments must be an array"
                )

            if not isinstance(mapping_schema, dict):
                raise ModuleExecutionError(
                    self.module_id,
                    "mapping_schema must be an object"
                )

            # First pass: collect all enrichment_data_id_fields used in schema
            # and build lookups for each
            enrichment_lookups: Dict[str, Dict[str, Dict[str, Any]]] = {}

            def collect_id_fields(schema_node: Dict[str, Any]):
                """Collect all unique enrichment_data_id_fields from schema"""
                schema_type = schema_node.get('type')

                if schema_type == 'enrichment_map':
                    id_field = schema_node.get('enrichment_data_id_field')
                    if id_field and id_field not in enrichment_lookups:
                        enrichment_lookups[id_field] = {}

                elif schema_type == 'object':
                    for prop_schema in schema_node.get('properties', {}).values():
                        collect_id_fields(prop_schema)

                elif schema_type == 'array':
                    items_schema = schema_node.get('items', {})
                    collect_id_fields(items_schema)

            collect_id_fields(mapping_schema)

            # Build enrichment lookups for each id_field
            for enrichment in enrichments:
                if not isinstance(enrichment, dict):
                    continue

                for id_field in enrichment_lookups.keys():
                    id_value = enrichment.get(id_field)
                    if id_value is not None:
                        id_str = str(id_value)
                        if id_str in enrichment_lookups[id_field]:
                            raise ModuleExecutionError(
                                self.module_id,
                                f"Duplicate enrichment ID for field '{id_field}': {id_str}"
                            )
                        enrichment_lookups[id_field][id_str] = enrichment

            total_enrichments = sum(len(lookup) for lookup in enrichment_lookups.values())
            context.logger.info(f"Built enrichment lookups: {total_enrichments} entries across {len(enrichment_lookups)} id fields")

            # Track which enrichments were used (per id_field)
            used_ids: Dict[str, Set[str]] = {id_field: set() for id_field in enrichment_lookups}
            # Track data objects that should have been enriched but weren't
            missing_enrichments: List[str] = []

            # Deep copy data to avoid modifying original
            enriched_data = deepcopy(data)

            def process_node(data_node: Any, schema_node: Dict[str, Any], path: str = ""):
                """Recursively process data according to mapping schema"""

                schema_type = schema_node.get('type')

                if schema_type == 'enrichment_map':
                    # This is an enrichment mapping - should not be called directly on data
                    # It's handled by the parent object processor
                    return

                elif schema_type == 'object':
                    if not isinstance(data_node, dict):
                        context.logger.warning(f"Expected object at {path}, got {type(data_node).__name__}")
                        return

                    properties = schema_node.get('properties', {})
                    for prop_name, prop_schema in properties.items():
                        prop_path = f"{path}.{prop_name}" if path else prop_name
                        prop_type = prop_schema.get('type')

                        if prop_type == 'enrichment_map':
                            # This property should be enriched
                            doc_id_field = prop_schema.get('document_data_id_field')
                            enrich_id_field = prop_schema.get('enrichment_data_id_field')
                            source_field = prop_schema.get('source_field')

                            if not doc_id_field or not enrich_id_field or not source_field:
                                raise ModuleExecutionError(
                                    self.module_id,
                                    f"enrichment_map at {prop_path} missing required fields "
                                    f"(document_data_id_field, enrichment_data_id_field, source_field)"
                                )

                            # Get the ID value from the data object
                            id_value = data_node.get(doc_id_field)
                            if id_value is None:
                                raise ModuleExecutionError(
                                    self.module_id,
                                    f"Missing document_data_id_field '{doc_id_field}' at {path}"
                                )

                            id_str = str(id_value)
                            lookup = enrichment_lookups.get(enrich_id_field, {})

                            # Look up enrichment
                            if id_str not in lookup:
                                missing_enrichments.append(f"{prop_path} (id={id_str})")
                            else:
                                enrichment = lookup[id_str]
                                if source_field not in enrichment:
                                    raise ModuleExecutionError(
                                        self.module_id,
                                        f"Enrichment for id={id_str} missing source field '{source_field}'"
                                    )
                                # Set the enriched value
                                data_node[prop_name] = enrichment[source_field]
                                used_ids[enrich_id_field].add(id_str)
                                context.logger.debug(f"Enriched {prop_path} from id={id_str}")

                        elif prop_name in data_node:
                            # Recurse into nested structure
                            process_node(data_node[prop_name], prop_schema, prop_path)

                elif schema_type == 'array':
                    if not isinstance(data_node, list):
                        context.logger.warning(f"Expected array at {path}, got {type(data_node).__name__}")
                        return

                    items_schema = schema_node.get('items', {})
                    for i, item in enumerate(data_node):
                        item_path = f"{path}[{i}]"
                        process_node(item, items_schema, item_path)

            # Start processing from root
            process_node(enriched_data, mapping_schema, "")

            # Validate: all data objects at enrichment points must have enrichment
            if missing_enrichments:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Data objects missing enrichment: {missing_enrichments}"
                )

            # Validate: all enrichments must have been used
            for id_field, lookup in enrichment_lookups.items():
                unused = set(lookup.keys()) - used_ids[id_field]
                if unused:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Unused enrichment IDs for '{id_field}' (no match in data): {sorted(unused)}"
                    )

            total_used = sum(len(ids) for ids in used_ids.values())
            context.logger.info(f"Enrichment complete: {total_used} fields enriched")

            return {
                "enriched_data": enriched_data
            }

        except ModuleExecutionError:
            raise
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to enrich data: {str(e)}",
                e
            )
