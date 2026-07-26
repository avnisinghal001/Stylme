package domain

import "fmt"

func ValidateGraph(graph SwarmGraph) error {
	if len(graph.Nodes) == 0 {
		return fmt.Errorf("graph must contain at least one node")
	}
	nodes := make(map[string]struct{}, len(graph.Nodes))
	for _, node := range graph.Nodes {
		if node.Key == "" || node.AgentID == "" {
			return fmt.Errorf("each graph node needs key and agentId")
		}
		if _, exists := nodes[node.Key]; exists {
			return fmt.Errorf("duplicate node key %q", node.Key)
		}
		nodes[node.Key] = struct{}{}
	}
	if _, ok := nodes[graph.EntryNodeKey]; !ok {
		return fmt.Errorf("entry node %q does not exist", graph.EntryNodeKey)
	}
	adjacency := make(map[string][]string, len(nodes))
	edges := map[string]bool{}
	for _, edge := range graph.Edges {
		if _, ok := nodes[edge.From]; !ok {
			return fmt.Errorf("edge source %q does not exist", edge.From)
		}
		if _, ok := nodes[edge.To]; !ok {
			return fmt.Errorf("edge target %q does not exist", edge.To)
		}
		if edge.From == edge.To {
			return fmt.Errorf("self edges are not allowed")
		}
		if edge.Condition.Field == "" || edge.Condition.Operator == "" {
			return fmt.Errorf("each edge needs a condition field and operator")
		}
		edgeKey := edge.From + "\x00" + edge.To
		if edges[edgeKey] {
			return fmt.Errorf("duplicate edge from %q to %q", edge.From, edge.To)
		}
		edges[edgeKey] = true
		adjacency[edge.From] = append(adjacency[edge.From], edge.To)
	}
	visiting := map[string]bool{}
	visited := map[string]bool{}
	var visit func(string) error
	visit = func(node string) error {
		if visiting[node] {
			return fmt.Errorf("graph must be acyclic")
		}
		if visited[node] {
			return nil
		}
		visiting[node] = true
		for _, next := range adjacency[node] {
			if err := visit(next); err != nil {
				return err
			}
		}
		visiting[node] = false
		visited[node] = true
		return nil
	}
	for key := range nodes {
		if err := visit(key); err != nil {
			return err
		}
	}
	reachable := map[string]bool{}
	var markReachable func(string)
	markReachable = func(node string) {
		if reachable[node] {
			return
		}
		reachable[node] = true
		for _, next := range adjacency[node] {
			markReachable(next)
		}
	}
	markReachable(graph.EntryNodeKey)
	if len(reachable) != len(nodes) {
		return fmt.Errorf("every graph node must be reachable from the entry node")
	}
	return nil
}
