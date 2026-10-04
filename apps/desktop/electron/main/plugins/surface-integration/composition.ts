/**
 * [INPUT]: Initialized plugin catalog, Chat/Project/App services and current account identity.
 * [OUTPUT]: Initializes the native plugin lifetime and attaches its catalog before cloud composition.
 * [POS]: Startup seam; initial compilation runs asynchronously and reports preparation/failure through the catalog.
 */
import {PluginSurfaceIntegration} from './service';
import {installPluginSurfaceIntegration} from './runtime';
import type {PluginCatalog} from '../catalog';
export async function initializePluginSurfaceIntegration(input:ConstructorParameters<typeof PluginSurfaceIntegration>[0]&{catalog:PluginCatalog}){
  const service=new PluginSurfaceIntegration(input);await service.initialize();
  installPluginSurfaceIntegration(service);service.attachCatalog(input.catalog);
  service.startSeed();return service;
}
