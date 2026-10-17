import { Input, signal, Text, View } from "nsh";
export default function R() {
  const name = signal("");
  const date = signal("");

  const handleSubmit = () => {
    console.log("Name:", name(), "Date:", date());
  };

  return (
    <View class="p-4 bg-white rounded-lg shadow-md">
      <Text class="text-lg font-semibold mb-2">Booking Form</Text>
      <View class="mb-4">
        <Text class="mb-1">Name</Text>
        <Input
          value={name()}
          onChangeText={name.set}
          class="border border-gray-300 rounded p-2"
          placeholder="Enter your name"
        />
      </View>
      <View class="mb-4">
        <Text class="mb-1">Date</Text>
        <Input
          value={date()}
          onChangeText={date.set}
          class="border border-gray-300 rounded p-2"
          placeholder="Select a date"
        />
      </View>
      <View onPress={handleSubmit} activeOpacity={0.7} class="bg-blue-500 rounded p-2">
        <Text class="text-white text-center">Submit</Text>
      </View>
    </View>
  );
}