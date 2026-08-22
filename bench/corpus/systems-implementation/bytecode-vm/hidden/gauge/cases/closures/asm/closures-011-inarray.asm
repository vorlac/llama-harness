; case closures-011-inarray
; expect exit=0 stdout="10\n6\n"
.func main arity=0 locals=1
  CLOSURE dbl
  CLOSURE inc
  NEW_ARRAY 2
  STORE_LOCAL 0
  LOAD_LOCAL 0
  PUSH_INT 0
  ARR_GET
  PUSH_INT 5
  CALL 1
  PRINT
  LOAD_LOCAL 0
  PUSH_INT 1
  ARR_GET
  PUSH_INT 5
  CALL 1
  PRINT
  RET
.end
.func dbl arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 2
  MUL
  RET
.end
.func inc arity=1 locals=1
  LOAD_LOCAL 0
  PUSH_INT 1
  ADD
  RET
.end
