/**
 * Copyright (c) 2016 Kiel University and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import type { EClass } from '../../emf/ecore/EClass.ts'
import type { EReference } from '../../emf/ecore/EReference.ts'
import type { EAttribute } from '../../emf/ecore/EAttribute.ts'
import type { EDataType } from '../../emf/ecore/EDataType.ts'
import type { EFactory } from '../../emf/ecore/EFactory.ts'
import type { EPackage } from '../../emf/ecore/EPackage.ts'
import type { ElkGraphFactory } from './ElkGraphFactory.ts'

export abstract class ElkGraphPackage implements EPackage {
  static readonly IPROPERTY_HOLDER = 0
  static readonly IPROPERTY_HOLDER_FEATURE_COUNT = 0
  static readonly EMAP_PROPERTY_HOLDER = 1
  static readonly EMAP_PROPERTY_HOLDER__PROPERTIES = ElkGraphPackage.IPROPERTY_HOLDER_FEATURE_COUNT + 0
  static readonly EMAP_PROPERTY_HOLDER_FEATURE_COUNT = ElkGraphPackage.IPROPERTY_HOLDER_FEATURE_COUNT + 1
  static readonly ELK_GRAPH_ELEMENT = 2
  static readonly ELK_GRAPH_ELEMENT__PROPERTIES = ElkGraphPackage.EMAP_PROPERTY_HOLDER__PROPERTIES
  static readonly ELK_GRAPH_ELEMENT__LABELS = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 0
  static readonly ELK_GRAPH_ELEMENT__IDENTIFIER = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 1
  static readonly ELK_GRAPH_ELEMENT_FEATURE_COUNT = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 2
  static readonly ELK_SHAPE = 3
  static readonly ELK_SHAPE__PROPERTIES = ElkGraphPackage.ELK_GRAPH_ELEMENT__PROPERTIES
  static readonly ELK_SHAPE__LABELS = ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS
  static readonly ELK_SHAPE__IDENTIFIER = ElkGraphPackage.ELK_GRAPH_ELEMENT__IDENTIFIER
  static readonly ELK_SHAPE__HEIGHT = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 0
  static readonly ELK_SHAPE__WIDTH = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 1
  static readonly ELK_SHAPE__X = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 2
  static readonly ELK_SHAPE__Y = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 3
  static readonly ELK_SHAPE_FEATURE_COUNT = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 4
  static readonly ELK_LABEL = 4
  static readonly ELK_LABEL__PROPERTIES = ElkGraphPackage.ELK_SHAPE__PROPERTIES
  static readonly ELK_LABEL__LABELS = ElkGraphPackage.ELK_SHAPE__LABELS
  static readonly ELK_LABEL__IDENTIFIER = ElkGraphPackage.ELK_SHAPE__IDENTIFIER
  static readonly ELK_LABEL__HEIGHT = ElkGraphPackage.ELK_SHAPE__HEIGHT
  static readonly ELK_LABEL__WIDTH = ElkGraphPackage.ELK_SHAPE__WIDTH
  static readonly ELK_LABEL__X = ElkGraphPackage.ELK_SHAPE__X
  static readonly ELK_LABEL__Y = ElkGraphPackage.ELK_SHAPE__Y
  static readonly ELK_LABEL__PARENT = ElkGraphPackage.ELK_SHAPE_FEATURE_COUNT + 0
  static readonly ELK_LABEL__TEXT = ElkGraphPackage.ELK_SHAPE_FEATURE_COUNT + 1
  static readonly ELK_LABEL_FEATURE_COUNT = ElkGraphPackage.ELK_SHAPE_FEATURE_COUNT + 2
  static readonly ELK_CONNECTABLE_SHAPE = 5
  static readonly ELK_CONNECTABLE_SHAPE__PROPERTIES = ElkGraphPackage.ELK_SHAPE__PROPERTIES
  static readonly ELK_CONNECTABLE_SHAPE__LABELS = ElkGraphPackage.ELK_SHAPE__LABELS
  static readonly ELK_CONNECTABLE_SHAPE__IDENTIFIER = ElkGraphPackage.ELK_SHAPE__IDENTIFIER
  static readonly ELK_CONNECTABLE_SHAPE__HEIGHT = ElkGraphPackage.ELK_SHAPE__HEIGHT
  static readonly ELK_CONNECTABLE_SHAPE__WIDTH = ElkGraphPackage.ELK_SHAPE__WIDTH
  static readonly ELK_CONNECTABLE_SHAPE__X = ElkGraphPackage.ELK_SHAPE__X
  static readonly ELK_CONNECTABLE_SHAPE__Y = ElkGraphPackage.ELK_SHAPE__Y
  static readonly ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES = ElkGraphPackage.ELK_SHAPE_FEATURE_COUNT + 0
  static readonly ELK_CONNECTABLE_SHAPE__INCOMING_EDGES = ElkGraphPackage.ELK_SHAPE_FEATURE_COUNT + 1
  static readonly ELK_CONNECTABLE_SHAPE_FEATURE_COUNT = ElkGraphPackage.ELK_SHAPE_FEATURE_COUNT + 2
  static readonly ELK_NODE = 6
  static readonly ELK_NODE__PROPERTIES = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__PROPERTIES
  static readonly ELK_NODE__LABELS = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__LABELS
  static readonly ELK_NODE__IDENTIFIER = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__IDENTIFIER
  static readonly ELK_NODE__HEIGHT = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__HEIGHT
  static readonly ELK_NODE__WIDTH = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__WIDTH
  static readonly ELK_NODE__X = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__X
  static readonly ELK_NODE__Y = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__Y
  static readonly ELK_NODE__OUTGOING_EDGES = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES
  static readonly ELK_NODE__INCOMING_EDGES = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES
  static readonly ELK_NODE__PORTS = ElkGraphPackage.ELK_CONNECTABLE_SHAPE_FEATURE_COUNT + 0
  static readonly ELK_NODE__CHILDREN = ElkGraphPackage.ELK_CONNECTABLE_SHAPE_FEATURE_COUNT + 1
  static readonly ELK_NODE__PARENT = ElkGraphPackage.ELK_CONNECTABLE_SHAPE_FEATURE_COUNT + 2
  static readonly ELK_NODE__CONTAINED_EDGES = ElkGraphPackage.ELK_CONNECTABLE_SHAPE_FEATURE_COUNT + 3
  static readonly ELK_NODE__HIERARCHICAL = ElkGraphPackage.ELK_CONNECTABLE_SHAPE_FEATURE_COUNT + 4
  static readonly ELK_NODE_FEATURE_COUNT = ElkGraphPackage.ELK_CONNECTABLE_SHAPE_FEATURE_COUNT + 5
  static readonly ELK_PORT = 7
  static readonly ELK_PORT__PROPERTIES = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__PROPERTIES
  static readonly ELK_PORT__LABELS = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__LABELS
  static readonly ELK_PORT__IDENTIFIER = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__IDENTIFIER
  static readonly ELK_PORT__HEIGHT = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__HEIGHT
  static readonly ELK_PORT__WIDTH = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__WIDTH
  static readonly ELK_PORT__X = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__X
  static readonly ELK_PORT__Y = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__Y
  static readonly ELK_PORT__OUTGOING_EDGES = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES
  static readonly ELK_PORT__INCOMING_EDGES = ElkGraphPackage.ELK_CONNECTABLE_SHAPE__INCOMING_EDGES
  static readonly ELK_PORT__PARENT = ElkGraphPackage.ELK_CONNECTABLE_SHAPE_FEATURE_COUNT + 0
  static readonly ELK_PORT_FEATURE_COUNT = ElkGraphPackage.ELK_CONNECTABLE_SHAPE_FEATURE_COUNT + 1
  static readonly ELK_EDGE = 8
  static readonly ELK_EDGE__PROPERTIES = ElkGraphPackage.ELK_GRAPH_ELEMENT__PROPERTIES
  static readonly ELK_EDGE__LABELS = ElkGraphPackage.ELK_GRAPH_ELEMENT__LABELS
  static readonly ELK_EDGE__IDENTIFIER = ElkGraphPackage.ELK_GRAPH_ELEMENT__IDENTIFIER
  static readonly ELK_EDGE__CONTAINING_NODE = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 0
  static readonly ELK_EDGE__SOURCES = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 1
  static readonly ELK_EDGE__TARGETS = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 2
  static readonly ELK_EDGE__SECTIONS = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 3
  static readonly ELK_EDGE__HYPEREDGE = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 4
  static readonly ELK_EDGE__HIERARCHICAL = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 5
  static readonly ELK_EDGE__SELFLOOP = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 6
  static readonly ELK_EDGE__CONNECTED = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 7
  static readonly ELK_EDGE_FEATURE_COUNT = ElkGraphPackage.ELK_GRAPH_ELEMENT_FEATURE_COUNT + 8
  static readonly ELK_BEND_POINT = 9
  static readonly ELK_BEND_POINT__X = 0
  static readonly ELK_BEND_POINT__Y = 1
  static readonly ELK_BEND_POINT_FEATURE_COUNT = 2
  static readonly ELK_EDGE_SECTION = 10
  static readonly ELK_EDGE_SECTION__PROPERTIES = ElkGraphPackage.EMAP_PROPERTY_HOLDER__PROPERTIES
  static readonly ELK_EDGE_SECTION__START_X = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 0
  static readonly ELK_EDGE_SECTION__START_Y = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 1
  static readonly ELK_EDGE_SECTION__END_X = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 2
  static readonly ELK_EDGE_SECTION__END_Y = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 3
  static readonly ELK_EDGE_SECTION__BEND_POINTS = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 4
  static readonly ELK_EDGE_SECTION__PARENT = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 5
  static readonly ELK_EDGE_SECTION__OUTGOING_SHAPE = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 6
  static readonly ELK_EDGE_SECTION__INCOMING_SHAPE = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 7
  static readonly ELK_EDGE_SECTION__OUTGOING_SECTIONS = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 8
  static readonly ELK_EDGE_SECTION__INCOMING_SECTIONS = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 9
  static readonly ELK_EDGE_SECTION__IDENTIFIER = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 10
  static readonly ELK_EDGE_SECTION_FEATURE_COUNT = ElkGraphPackage.EMAP_PROPERTY_HOLDER_FEATURE_COUNT + 11
  static readonly ELK_PROPERTY_TO_VALUE_MAP_ENTRY = 11
  static readonly ELK_PROPERTY_TO_VALUE_MAP_ENTRY__KEY = 0
  static readonly ELK_PROPERTY_TO_VALUE_MAP_ENTRY__VALUE = 1
  static readonly ELK_PROPERTY_TO_VALUE_MAP_ENTRY_FEATURE_COUNT = 2
  static readonly IPROPERTY = 12
  static readonly PROPERTY_VALUE = 13
  static readonly eNAME = "graph"
  static readonly eNS_URI = "http://www.eclipse.org/elk/ElkGraph"
  static readonly eNS_PREFIX = "graph"
  static get eINSTANCE(): ElkGraphPackage { return (require('./impl/ElkGraphPackageImpl.ts') as { ElkGraphPackageImpl: { init(): ElkGraphPackage } }).ElkGraphPackageImpl.init() }
  abstract getEFactoryInstance(): EFactory
  abstract getIPropertyHolder(): EClass
  abstract getEMapPropertyHolder(): EClass
  abstract getEMapPropertyHolder_Properties(): EReference
  abstract getElkGraphElement(): EClass
  abstract getElkGraphElement_Labels(): EReference
  abstract getElkGraphElement_Identifier(): EAttribute
  abstract getElkShape(): EClass
  abstract getElkShape_Height(): EAttribute
  abstract getElkShape_Width(): EAttribute
  abstract getElkShape_X(): EAttribute
  abstract getElkShape_Y(): EAttribute
  abstract getElkLabel(): EClass
  abstract getElkLabel_Parent(): EReference
  abstract getElkLabel_Text(): EAttribute
  abstract getElkConnectableShape(): EClass
  abstract getElkConnectableShape_OutgoingEdges(): EReference
  abstract getElkConnectableShape_IncomingEdges(): EReference
  abstract getElkNode(): EClass
  abstract getElkNode_Ports(): EReference
  abstract getElkNode_Children(): EReference
  abstract getElkNode_Parent(): EReference
  abstract getElkNode_ContainedEdges(): EReference
  abstract getElkNode_Hierarchical(): EAttribute
  abstract getElkPort(): EClass
  abstract getElkPort_Parent(): EReference
  abstract getElkEdge(): EClass
  abstract getElkEdge_ContainingNode(): EReference
  abstract getElkEdge_Sources(): EReference
  abstract getElkEdge_Targets(): EReference
  abstract getElkEdge_Sections(): EReference
  abstract getElkEdge_Hyperedge(): EAttribute
  abstract getElkEdge_Hierarchical(): EAttribute
  abstract getElkEdge_Selfloop(): EAttribute
  abstract getElkEdge_Connected(): EAttribute
  abstract getElkBendPoint(): EClass
  abstract getElkBendPoint_X(): EAttribute
  abstract getElkBendPoint_Y(): EAttribute
  abstract getElkEdgeSection(): EClass
  abstract getElkEdgeSection_StartX(): EAttribute
  abstract getElkEdgeSection_StartY(): EAttribute
  abstract getElkEdgeSection_EndX(): EAttribute
  abstract getElkEdgeSection_EndY(): EAttribute
  abstract getElkEdgeSection_BendPoints(): EReference
  abstract getElkEdgeSection_Parent(): EReference
  abstract getElkEdgeSection_OutgoingShape(): EReference
  abstract getElkEdgeSection_IncomingShape(): EReference
  abstract getElkEdgeSection_OutgoingSections(): EReference
  abstract getElkEdgeSection_IncomingSections(): EReference
  abstract getElkEdgeSection_Identifier(): EAttribute
  abstract getElkPropertyToValueMapEntry(): EClass
  abstract getElkPropertyToValueMapEntry_Key(): EAttribute
  abstract getElkPropertyToValueMapEntry_Value(): EAttribute
  abstract getIProperty(): EDataType
  abstract getPropertyValue(): EDataType
  abstract getElkGraphFactory(): ElkGraphFactory
}

export namespace ElkGraphPackage {
  export class Literals {
    static get IPROPERTY_HOLDER(): EClass { return ElkGraphPackage.eINSTANCE.getIPropertyHolder() }
    static get EMAP_PROPERTY_HOLDER(): EClass { return ElkGraphPackage.eINSTANCE.getEMapPropertyHolder() }
    static get EMAP_PROPERTY_HOLDER__PROPERTIES(): EReference { return ElkGraphPackage.eINSTANCE.getEMapPropertyHolder_Properties() }
    static get ELK_GRAPH_ELEMENT(): EClass { return ElkGraphPackage.eINSTANCE.getElkGraphElement() }
    static get ELK_GRAPH_ELEMENT__LABELS(): EReference { return ElkGraphPackage.eINSTANCE.getElkGraphElement_Labels() }
    static get ELK_GRAPH_ELEMENT__IDENTIFIER(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkGraphElement_Identifier() }
    static get ELK_SHAPE(): EClass { return ElkGraphPackage.eINSTANCE.getElkShape() }
    static get ELK_SHAPE__HEIGHT(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkShape_Height() }
    static get ELK_SHAPE__WIDTH(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkShape_Width() }
    static get ELK_SHAPE__X(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkShape_X() }
    static get ELK_SHAPE__Y(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkShape_Y() }
    static get ELK_LABEL(): EClass { return ElkGraphPackage.eINSTANCE.getElkLabel() }
    static get ELK_LABEL__PARENT(): EReference { return ElkGraphPackage.eINSTANCE.getElkLabel_Parent() }
    static get ELK_LABEL__TEXT(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkLabel_Text() }
    static get ELK_CONNECTABLE_SHAPE(): EClass { return ElkGraphPackage.eINSTANCE.getElkConnectableShape() }
    static get ELK_CONNECTABLE_SHAPE__OUTGOING_EDGES(): EReference { return ElkGraphPackage.eINSTANCE.getElkConnectableShape_OutgoingEdges() }
    static get ELK_CONNECTABLE_SHAPE__INCOMING_EDGES(): EReference { return ElkGraphPackage.eINSTANCE.getElkConnectableShape_IncomingEdges() }
    static get ELK_NODE(): EClass { return ElkGraphPackage.eINSTANCE.getElkNode() }
    static get ELK_NODE__PORTS(): EReference { return ElkGraphPackage.eINSTANCE.getElkNode_Ports() }
    static get ELK_NODE__CHILDREN(): EReference { return ElkGraphPackage.eINSTANCE.getElkNode_Children() }
    static get ELK_NODE__PARENT(): EReference { return ElkGraphPackage.eINSTANCE.getElkNode_Parent() }
    static get ELK_NODE__CONTAINED_EDGES(): EReference { return ElkGraphPackage.eINSTANCE.getElkNode_ContainedEdges() }
    static get ELK_NODE__HIERARCHICAL(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkNode_Hierarchical() }
    static get ELK_PORT(): EClass { return ElkGraphPackage.eINSTANCE.getElkPort() }
    static get ELK_PORT__PARENT(): EReference { return ElkGraphPackage.eINSTANCE.getElkPort_Parent() }
    static get ELK_EDGE(): EClass { return ElkGraphPackage.eINSTANCE.getElkEdge() }
    static get ELK_EDGE__CONTAINING_NODE(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdge_ContainingNode() }
    static get ELK_EDGE__SOURCES(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdge_Sources() }
    static get ELK_EDGE__TARGETS(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdge_Targets() }
    static get ELK_EDGE__SECTIONS(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdge_Sections() }
    static get ELK_EDGE__HYPEREDGE(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdge_Hyperedge() }
    static get ELK_EDGE__HIERARCHICAL(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdge_Hierarchical() }
    static get ELK_EDGE__SELFLOOP(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdge_Selfloop() }
    static get ELK_EDGE__CONNECTED(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdge_Connected() }
    static get ELK_BEND_POINT(): EClass { return ElkGraphPackage.eINSTANCE.getElkBendPoint() }
    static get ELK_BEND_POINT__X(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkBendPoint_X() }
    static get ELK_BEND_POINT__Y(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkBendPoint_Y() }
    static get ELK_EDGE_SECTION(): EClass { return ElkGraphPackage.eINSTANCE.getElkEdgeSection() }
    static get ELK_EDGE_SECTION__START_X(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_StartX() }
    static get ELK_EDGE_SECTION__START_Y(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_StartY() }
    static get ELK_EDGE_SECTION__END_X(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_EndX() }
    static get ELK_EDGE_SECTION__END_Y(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_EndY() }
    static get ELK_EDGE_SECTION__BEND_POINTS(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_BendPoints() }
    static get ELK_EDGE_SECTION__PARENT(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_Parent() }
    static get ELK_EDGE_SECTION__OUTGOING_SHAPE(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_OutgoingShape() }
    static get ELK_EDGE_SECTION__INCOMING_SHAPE(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_IncomingShape() }
    static get ELK_EDGE_SECTION__OUTGOING_SECTIONS(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_OutgoingSections() }
    static get ELK_EDGE_SECTION__INCOMING_SECTIONS(): EReference { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_IncomingSections() }
    static get ELK_EDGE_SECTION__IDENTIFIER(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkEdgeSection_Identifier() }
    static get ELK_PROPERTY_TO_VALUE_MAP_ENTRY(): EClass { return ElkGraphPackage.eINSTANCE.getElkPropertyToValueMapEntry() }
    static get ELK_PROPERTY_TO_VALUE_MAP_ENTRY__KEY(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkPropertyToValueMapEntry_Key() }
    static get ELK_PROPERTY_TO_VALUE_MAP_ENTRY__VALUE(): EAttribute { return ElkGraphPackage.eINSTANCE.getElkPropertyToValueMapEntry_Value() }
    static get IPROPERTY(): EDataType { return ElkGraphPackage.eINSTANCE.getIProperty() }
    static get PROPERTY_VALUE(): EDataType { return ElkGraphPackage.eINSTANCE.getPropertyValue() }
  }
}
