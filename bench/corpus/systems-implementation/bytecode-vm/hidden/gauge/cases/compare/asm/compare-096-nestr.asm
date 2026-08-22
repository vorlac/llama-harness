; case compare-096-nestr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR "hello"
  NE
  PRINT
  RET
.end
