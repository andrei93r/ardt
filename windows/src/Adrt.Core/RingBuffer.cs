// Port of src/core/ringbuffer.ts. Keep names and semantics 1:1 with the TypeScript.
namespace Adrt.Core;

/// <summary>
/// Fixed-capacity circular buffer (§5.11). <c>Push</c> overwrites the oldest item
/// once full and never shifts: O(1) per push instead of the O(n) copy an
/// unbounded array with <c>shift()</c> pays on every event past the cap.
///
/// <c>Tail</c>/<c>TailWhere</c> always hand back <b>insertion order</b> (oldest
/// first), so this is a drop-in for a bounded "last N" log kept on the compositor
/// thread. The backing array is allocated once; only <c>Clear</c> replaces it,
/// releasing the retained entries immediately.
/// </summary>
public sealed class RingBuffer<T>
{
    private readonly int _capacity;
    private T[] _items;

    /// <summary>Index the next <c>Push</c> writes to.</summary>
    private int _head;

    /// <summary>Live item count, never above <c>capacity</c>.</summary>
    private int _size;

    public RingBuffer(int capacity)
    {
        _capacity = Math.Max(0, capacity);
        _items = new T[_capacity];
    }

    public int Length => _size;

    public void Push(T item)
    {
        if (_capacity == 0) return;
        _items[_head] = item;
        _head = (_head + 1) % _capacity;
        if (_size < _capacity) _size += 1;
    }

    public void Clear()
    {
        _items = new T[_capacity];
        _head = 0;
        _size = 0;
    }

    /// <summary>The newest <paramref name="limit"/> items, oldest first. Fewer when not yet full.</summary>
    public IReadOnlyList<T> Tail(int limit)
    {
        var count = limit > 0 ? Math.Min(limit, _size) : 0;
        var output = new T[count];
        var first = _size - count;
        for (var index = 0; index < count; index += 1) output[index] = ItemAt(first + index);
        return output;
    }

    /// <summary>The newest <paramref name="limit"/> items matching <paramref name="predicate"/>, oldest first.</summary>
    public IReadOnlyList<T> TailWhere(Func<T, bool> predicate, int limit)
    {
        var count = limit > 0 ? limit : 0;
        var output = new List<T>();
        for (var index = _size - 1; index >= 0 && output.Count < count; index -= 1)
        {
            var item = ItemAt(index);
            if (predicate(item)) output.Add(item);
        }
        output.Reverse();
        return output;
    }

    /// <summary>The item at logical position <paramref name="index"/> (0 = oldest); <c>0 &lt;= index &lt; size</c>.</summary>
    private T ItemAt(int index) => _items[(_head - _size + index + _capacity) % _capacity];
}
