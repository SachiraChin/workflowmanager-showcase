"""
Module Registry - Discovers and manages workflow modules
"""

from typing import Dict, Optional
from .module_interface import ModuleBase, Module


class ModuleRegistry:
    """
    Registry for workflow modules.

    Modules can be registered manually or discovered automatically.
    Provides lookup by module ID (e.g., 'user.text_input', 'api.call').

    Note: Registry stores module CLASSES, not instances. Each get_module()
    call creates a fresh instance to avoid state leakage between uses.
    """

    def __init__(self):
        """Initialize empty registry - stores module classes, not instances"""
        self._module_classes: Dict[str, type] = {}

    def register(self, module: Module) -> None:
        """
        Register a module class (extracted from instance).

        Args:
            module: Module instance (class is extracted for registration)

        Raises:
            ValueError: If module ID already registered
        """
        module_id = module.module_id
        if module_id in self._module_classes:
            raise ValueError(f"Module '{module_id}' is already registered")

        # Store the class, not the instance
        self._module_classes[module_id] = type(module)

    def get_module(self, module_id: str) -> Module:
        """
        Get a fresh module instance by ID.

        Creates a new instance each time to avoid state leakage between uses.

        Args:
            module_id: Module identifier (e.g., 'user.text_input')

        Returns:
            Fresh module instance

        Raises:
            KeyError: If module not found
        """
        if module_id not in self._module_classes:
            raise KeyError(f"Module '{module_id}' not found in registry")

        # Create fresh instance each time
        return self._module_classes[module_id]()

    def has_module(self, module_id: str) -> bool:
        """
        Check if module exists

        Args:
            module_id: Module identifier

        Returns:
            True if module is registered
        """
        return module_id in self._module_classes

    def list_modules(self) -> list:
        """
        Get list of all registered module IDs

        Returns:
            List of module IDs
        """
        return list(self._module_classes.keys())

    def unregister(self, module_id: str) -> None:
        """
        Unregister a module

        Args:
            module_id: Module identifier

        Raises:
            KeyError: If module not found
        """
        if module_id not in self._module_classes:
            raise KeyError(f"Module '{module_id}' not found in registry")

        del self._module_classes[module_id]

    def clear(self) -> None:
        """Clear all registered modules"""
        self._module_classes.clear()

    def discover_modules(self, modules_path: Optional[str] = None) -> int:
        """
        Automatically discover and register all modules

        Args:
            modules_path: Path to modules directory (defaults to ./modules)

        Returns:
            Number of modules discovered and registered
        """
        import os
        import importlib
        import inspect
        from pathlib import Path

        if modules_path is None:
            # Default to modules directory relative to this file
            current_dir = Path(__file__).parent
            modules_path = current_dir.parent / "modules"
        else:
            modules_path = Path(modules_path)

        if not modules_path.exists():
            raise FileNotFoundError(f"Modules directory not found: {modules_path}")

        registered_count = 0

        # Scan each category directory (display, user, api, etc.)
        for category_dir in modules_path.iterdir():
            if not category_dir.is_dir():
                continue

            if category_dir.name.startswith("_"):
                continue

            # Scan Python files in category directory
            for py_file in category_dir.glob("*.py"):
                if py_file.name.startswith("_"):
                    continue

                # Import the module
                try:
                    module_name = py_file.stem
                    import_path = f"modules.{category_dir.name}.{module_name}"

                    module = importlib.import_module(import_path)

                    # Find ModuleBase subclasses in the imported module
                    for name, obj in inspect.getmembers(module):
                        if (inspect.isclass(obj) and
                            issubclass(obj, ModuleBase) and
                            obj is not ModuleBase and
                            not inspect.isabstract(obj)):

                            # Instantiate and register the module
                            try:
                                module_instance = obj()
                                self.register(module_instance)
                                registered_count += 1
                            except Exception as e:
                                # Skip modules that fail to instantiate
                                pass

                except Exception as e:
                    # Skip files that fail to import
                    pass

        return registered_count
