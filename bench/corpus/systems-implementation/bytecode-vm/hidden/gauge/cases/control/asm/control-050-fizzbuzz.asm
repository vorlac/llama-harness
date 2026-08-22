; case control-050-fizzbuzz
; expect exit=0 stdout="1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz\n"
.func main arity=0 locals=1
  PUSH_INT 1
  STORE_LOCAL 0
loop:
  LOAD_LOCAL 0
  PUSH_INT 15
  LE
  JMP_IF_FALSE done
  LOAD_LOCAL 0
  PUSH_INT 15
  MOD
  PUSH_INT 0
  EQ
  JMP_IF_FALSE notfb
  PUSH_STR "FizzBuzz"
  PRINT
  JMP next
notfb:
  LOAD_LOCAL 0
  PUSH_INT 3
  MOD
  PUSH_INT 0
  EQ
  JMP_IF_FALSE notf
  PUSH_STR "Fizz"
  PRINT
  JMP next
notf:
  LOAD_LOCAL 0
  PUSH_INT 5
  MOD
  PUSH_INT 0
  EQ
  JMP_IF_FALSE notb
  PUSH_STR "Buzz"
  PRINT
  JMP next
notb:
  LOAD_LOCAL 0
  PRINT
next:
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
  JMP loop
done:
  RET
.end
