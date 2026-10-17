import { Scroll, signal, Text, View } from "nsh";
export default function R() {
  const todos = signal([{ id: 1, text: "Task 1", completed: false }, { id: 2, text: "Task 2", completed: false }]);

  const toggleTodo = (id: number) => {
    todos.update((current) =>
      current.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo))
    );
  };

  return (
    <View class="flex flex-col p-4">
      <Text class="text-lg font-bold mb-2">Todo Checklist</Text>
      <Scroll class="flex-1 overflow-hidden">
        <Each of={todos()}>
          {(item, i) => (
            <View onPress={() => toggleTodo(item().id)} class="flex-row items-center p-2 border-b border-gray-300">
              <View class={`w-5 h-5 rounded-full ${item().completed ? 'bg-green-500' : 'bg-gray-300'}`} />
              <Text class={`ml-2 text-lg ${item().completed ? 'line-through text-gray-500' : 'text-black'}`}>{item().text}</Text>
            </View>
          )}
        </Each>
      </Scroll>
    </View>
  );
}