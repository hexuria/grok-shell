import { signal, Text, View } from "nsh";

const CLIENTS: string[] = ["Acme Corp", "Globex Ltd", "Initech", "Umbrella Co", "Stark Labs"];
const ITEMS: string[] = ["Design sprint", "API integration", "Hosting (monthly)", "Consulting hours", "Data migration", "QA testing"];

type Line = { desc: string; qty: number; rate: number; amount: number };
type Invoice = {
  num: string;
  client: string;
  lines: Line[];
  subtotal: number;
  tax: number;
  total: number;
  due: number;
};

const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)];
const rnd = (a: number, b: number): number => Math.floor(a + Math.random() * (b - a));
const money = (n: number): string => "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function makeInvoice(): Invoice {
  const n = rnd(2, 5);
  const lines: Line[] = Array.from({ length: n }, (): Line => {
    const qty = rnd(1, 9);
    const rate = rnd(40, 240);
    return { desc: pick(ITEMS), qty, rate, amount: qty * rate };
  });
  const subtotal = lines.reduce((s: number, l: Line) => s + l.amount, 0);
  const tax = Math.round(subtotal * 0.08);
  return {
    num: "INV-" + rnd(1000, 9999),
    client: pick(CLIENTS),
    lines,
    subtotal,
    tax,
    total: subtotal + tax,
    due: rnd(7, 31),
  };
}

export default function R() {
  const inv = signal<Invoice>(makeInvoice());

  return (
    <View class="flex-col bg-white rounded-xl border border-gray-200 p-4 gap-3 w-full">
      <View class="flex-row justify-between items-center">
        <View class="flex-col">
          <Text class="text-lg font-bold text-gray-900">Invoice</Text>
          <Text class="text-xs text-gray-500">{inv().num}</Text>
        </View>
        <View class="rounded-full bg-emerald-100 px-2 py-1">
          <Text class="text-xs font-semibold text-emerald-700">Due in {inv().due} days</Text>
        </View>
      </View>

      <View class="flex-col gap-1">
        <Text class="text-xs text-gray-500 uppercase">Billed to</Text>
        <Text class="text-sm font-semibold text-gray-800">{inv().client}</Text>
      </View>

      <View class="h-px bg-gray-200" />

      <View class="flex-col gap-2">
        <Each of={inv().lines}>
          {(l: any) => (
            <View class="flex-row justify-between items-center">
              <View class="flex-col flex-1 pr-2">
                <Text class="text-sm text-gray-800">{l().desc}</Text>
                <Text class="text-xs text-gray-500">
                  {l().qty} × {money(l().rate)}
                </Text>
              </View>
              <Text class="text-sm font-medium text-gray-900">{money(l().amount)}</Text>
            </View>
          )}
        </Each>
      </View>

      <View class="h-px bg-gray-200" />

      <View class="flex-col gap-1">
        <View class="flex-row justify-between">
          <Text class="text-xs text-gray-500">Subtotal</Text>
          <Text class="text-xs text-gray-700">{money(inv().subtotal)}</Text>
        </View>
        <View class="flex-row justify-between">
          <Text class="text-xs text-gray-500">Tax (8%)</Text>
          <Text class="text-xs text-gray-700">{money(inv().tax)}</Text>
        </View>
        <View class="flex-row justify-between pt-1">
          <Text class="text-base font-bold text-gray-900">Total</Text>
          <Text class="text-base font-bold text-indigo-600">{money(inv().total)}</Text>
        </View>
      </View>

      <View
        class="rounded-lg bg-indigo-600 py-2 items-center"
        onPress={() => inv.set(makeInvoice())}
        activeOpacity={0.7}
      >
        <Text class="text-sm font-semibold text-white">Generate new invoice</Text>
      </View>
    </View>
  );
}