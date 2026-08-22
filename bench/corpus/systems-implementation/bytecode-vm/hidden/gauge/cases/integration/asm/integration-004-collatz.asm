; case integration-004-collatz
; expect exit=0 stdout="111\n16\n0\n118\n"
.func main arity=0 locals=0
  CLOSURE steps
  PUSH_INT 27
  CALL 1
  PRINT
  CLOSURE steps
  PUSH_INT 7
  CALL 1
  PRINT
  CLOSURE steps
  PUSH_INT 1
  CALL 1
  PRINT
  CLOSURE steps
  PUSH_INT 97
  CALL 1
  PRINT
  RET
.end
.func steps arity=1 locals=2
  PUSH_INT 0
  STORE_LOCAL 1
top:
  LOAD_LOCAL 0
  PUSH_INT 1
  EQ
  JMP_IF_TRUE done
  LOAD_LOCAL 0
  PUSH_INT 2
  MOD
  PUSH_INT 0
  EQ
  JMP_IF_FALSE odd
  LOAD_LOCAL 0
  PUSH_INT 2
  DIV
  STORE_LOCAL 0
  JMP inc
odd:
  LOAD_LOCAL 0
  PUSH_INT 3
  MUL
  PUSH_INT 1
  ADD
  STORE_LOCAL 0
inc:
  LOAD_LOCAL 1
  PUSH_INT 1
  ADD
  STORE_LOCAL 1
  JMP top
done:
  LOAD_LOCAL 1
  RET
.end
