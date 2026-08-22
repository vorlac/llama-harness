; case locals-006-params
; expect exit=0 stdout="10\n20\n30\nnil\n"
.func main arity=0 locals=0
  CLOSURE three
  PUSH_INT 10
  PUSH_INT 20
  PUSH_INT 30
  CALL 3
  PRINT
  RET
.end
.func three arity=3 locals=3
  LOAD_LOCAL 0
  PRINT
  LOAD_LOCAL 1
  PRINT
  LOAD_LOCAL 2
  PRINT
  PUSH_NIL
  RET
.end
