import { signal, Text, View, Scroll } from "nsh";

export default function R() {
  const card1Title = signal("Card 1");
  const card1Content = signal("This is the content of card 1.");
  const card2Title = signal("Card 2");
  const card2Content = signal("This is the content of card 2.");
  const card3Title = signal("Card 3");
  const card3Content = signal("This is the content of card 3.");

  return (
    <Scroll class="flex flex-col gap-4 p-4">
      <View class="border rounded-lg p-4 bg-white shadow">
        <Text class="font-bold text-lg">{card1Title()}</Text>
        <Text class="text-gray-700">{card1Content()}</Text>
      </View>
      <View class="border rounded-lg p-4 bg-white shadow">
        <Text class="font-bold text-lg">{card2Title()}</Text>
        <Text class="text-gray-700">{card2Content()}</Text>
      </View>
      <View class="border rounded-lg p-4 bg-white shadow">
        <Text class="font-bold text-lg">{card3Title()}</Text>
        <Text class="text-gray-700">{card3Content()}</Text>
      </View>
    </Scroll>
  );
}