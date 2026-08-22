; case calls-022-halt
; expect exit=0 stdout="a\nb\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PRINT
  CLOSURE stop
  CALL 0
  PUSH_STR "never"
  PRINT
  RET
.end
.func stop arity=0 locals=0
  PUSH_STR "b"
  PRINT
  HALT
  RET
.end
