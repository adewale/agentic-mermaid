/*******************************************************************************
 * Copyright (c) 2002-2011 IBM Corporation and others.
 * This TypeScript translation is made available under the Eclipse Public
 * License 2.0, http://www.eclipse.org/legal/epl-2.0, pursuant to the original
 * EPL-1.0 section 7 subsequent-version option.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import type { EObject } from '../EObject.ts'

export class EcoreUtil {
  static isAncestor(ancestor: EObject | null, object: EObject | null): boolean { if (ancestor !== null) for (let current = object; current !== null; current = current.eContainer()) if (current === ancestor) return true; return false }
  static getRootContainer(object: EObject): EObject { let result = object; for (let parent = result.eContainer(); parent !== null; parent = result.eContainer()) result = parent; return result }
}
