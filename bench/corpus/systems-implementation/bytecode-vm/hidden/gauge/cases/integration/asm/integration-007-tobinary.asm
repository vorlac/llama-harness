; case integration-007-tobinary
; expect exit=0 stdout="0\n1\n10\n1101\n11111111\n10000000000\n"
.func main arity=0 locals=0
  CLOSURE tobin
  PUSH_INT 0
  CALL 1
  PRINT
  CLOSURE tobin
  PUSH_INT 1
  CALL 1
  PRINT
  CLOSURE tobin
  PUSH_INT 2
  CALL 1
  PRINT
  CLOSURE tobin
  PUSH_INT 13
  CALL 1
  PRINT
  CLOSURE tobin
  PUSH_INT 255
  CALL 1
  PRINT
  CLOSURE tobin
  PUSH_INT 1024
  CALL 1
  PRINT
  RET
.end
.func tobin arity=1 locals=2
  PUSH_STR ""
  STORE_LOCAL 1
  LOAD_LOCAL 0
  PUSH_INT 0
  EQ
  JMP_IF_FALSE loop
  PUSH_STR "0"
  RET
loop:
  LOAD_LOCAL 0
  PUSH_INT 0
  GT
  JMP_IF_FALSE done
  LOAD_LOCAL 0
  PUSH_INT 2
  MOD
  TOSTR
  LOAD_LOCAL 1
  CONCAT
  STORE_LOCAL 1
  LOAD_LOCAL 0
  PUSH_INT 2
  DIV
  STORE_LOCAL 0
  JMP loop
done:
  LOAD_LOCAL 1
  RET
.end
